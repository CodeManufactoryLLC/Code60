import { z } from "zod";

z.config({ jitless: true });

export const browserModes = ["headless", "visible", "existing-browser"] as const;
export type BrowserMode = (typeof browserModes)[number];

const browserRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({ action: z.literal("set-mode"), mode: z.enum(browserModes) }),
  z.strictObject({ action: z.literal("list-tools") }),
  z.strictObject({
    action: z.literal("call"),
    name: z
      .string()
      .max(100)
      .regex(/^browser_[a-z][a-z0-9_]*$/),
    arguments: z.record(z.string(), z.json()),
  }),
  z.strictObject({ action: z.literal("close") }),
]);
type BrowserRequest = z.infer<typeof browserRequest>;
export function parseBrowserRequest(value: unknown): BrowserRequest {
  const result = browserRequest.safeParse(value);
  if (!result.success) throw new Error("Invalid browser request");
  return result.data;
}

export const BROWSER_TOOL = {
  kind: "browser" as const,
  name: "code60_browser" as const,
  title: "Use browser",
  description:
    "Automate websites in this conversation. Default mode is headless; set-mode selects headless, visible (a separate window), or existing-browser (the user's Chrome/Edge tabs through the Playwright extension). Follow a preference stated in chat. Switching mode closes the previous connection and loses isolated browser state. Use list-tools to discover Playwright signatures, then call with the exact name and arguments. status and set-mode do not launch anything; list-tools/call may download the pinned Playwright MCP package. Existing Browser requires the extension and its connection approval; never silently fall back. close releases the connection. Browser actions are external effects and are not reversed by message Undo. This does not control native desktop apps.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["status", "set-mode", "list-tools", "call", "close"] },
      mode: {
        type: "string",
        enum: browserModes,
        description: "Required only for set-mode. The selection lasts for this live conversation.",
      },
      name: { type: "string", pattern: "^browser_[a-z][a-z0-9_]*$", maxLength: 100 },
      arguments: {
        type: "object",
        additionalProperties: true,
        description: "Required only for call. Use the schema returned by list-tools.",
      },
    },
    required: ["action"],
    additionalProperties: false as const,
  },
  readOnly: false,
  destructive: false,
};
