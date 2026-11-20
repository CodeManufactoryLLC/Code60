import { TOOL_KINDS } from "../agents/index.js";
import type { Mode, PermissionPolicy, PermissionRule, ToolKind } from "./types.js";
import { UsageError } from "./types.js";

export interface PolicyOverrides {
  allow?: readonly ToolKind[];
  allowAll?: boolean;
  /** Desktop orchestration preference, sampled when each request arrives. */
  orchestrationAutoApproval?: () => boolean;
}

/** Decides one permission request. Flags win, then the policy; headless mode turns `ask` into `deny`. */
export function decide(
  kind: ToolKind,
  policy: PermissionPolicy,
  mode: Mode,
  overrides: PolicyOverrides = {},
): PermissionRule {
  if (mode === "interactive" && overrides.orchestrationAutoApproval)
    return overrides.orchestrationAutoApproval() ? "allow" : "ask";
  if (overrides.allowAll || overrides.allow?.includes(kind)) return "allow";
  const rule = policy[kind] ?? policy.default;
  return rule === "ask" && mode === "headless" ? "deny" : rule;
}

export function parseToolKinds(values: readonly string[]): ToolKind[] {
  return values.map((value) => {
    if (!(TOOL_KINDS as readonly string[]).includes(value)) {
      throw new UsageError(
        `unknown tool-call kind '${value}' for --allow (expected one of: ${TOOL_KINDS.join(", ")})`,
      );
    }
    return value as ToolKind;
  });
}
