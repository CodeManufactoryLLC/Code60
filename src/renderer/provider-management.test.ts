import { beforeEach, expect, it, vi } from "vitest";
import type { ApplicationClient, Snapshot } from "../bridge/index.js";
import { useProviderManagement } from "./provider-management.js";

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [
      hooks.slots[index],
      (value: unknown) => {
        hooks.slots[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    hooks.slots[index] ??= { current: initial };
    return hooks.slots[index];
  },
}));
beforeEach(() => {
  hooks.slots = [];
  hooks.index = 0;
});
function fixture() {
  const api = {
    providerAction: vi.fn(async () => {}),
    modelDefault: vi.fn(async () => {}),
  } as unknown as ApplicationClient;
  const snapshot = {
    agentSetup: {
      complete: true,
      primary: "claude",
      enabled: ["claude", "codex"],
      session: null,
      management: { blockedReason: null },
      providers: [{ id: "claude" }, { id: "codex" }, { id: "kiro" }],
    },
  } as Snapshot;
  const render = () => {
    hooks.index = 0;
    return useProviderManagement(api, snapshot);
  };
  return { api, snapshot, render };
}
it("shares single-flight state and retryable failures across consumers", async () => {
  const { api, render } = fixture();
  let release!: () => void;
  vi.mocked(api.providerAction).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const gallery = render();
  const pending = gallery.act({ type: "set-primary", provider: "codex" });
  expect(render().pending).toBe(true);
  await gallery.act({ type: "disconnect", provider: "codex" });
  expect(api.providerAction).toHaveBeenCalledTimes(1);
  release();
  await pending;
  expect(render().pending).toBe(false);
  vi.mocked(api.providerAction).mockRejectedValueOnce(new Error("Save failed. Retry."));
  await render().act({ type: "disconnect", provider: "codex" });
  expect(render().error).toBe("Save failed. Retry.");
  await render().act({ type: "disconnect", provider: "codex" });
  expect(render().error).toBe("");
});
it("keeps primary actions blocked and clears only the selected role's saved default", async () => {
  const { api, render } = fixture();
  await render().act({ type: "disconnect", provider: "claude" });
  await render().act({ type: "set-primary", provider: "claude" });
  expect(api.providerAction).not.toHaveBeenCalled();
  const request = { type: "clear", provider: "claude", role: "worker" } as const;
  await render().clearDefault(request);
  expect(api.modelDefault).toHaveBeenCalledExactlyOnceWith(request);
});
it("uses add setup, gates duplicates and retains the creation control when the catalog is exhausted", () => {
  const { snapshot, render } = fixture();
  render().add();
  expect(render().mode).toBe("add");
  render().closeSetup();
  expect(render().mode).toBeNull();
  if (!snapshot.agentSetup) throw new Error("Missing setup");
  snapshot.agentSetup.enabled.push("kiro");
  expect(render().addReason).toBe("All supported providers are connected");
  render().add();
  expect(render().mode).toBeNull();
});
