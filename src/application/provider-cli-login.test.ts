import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { loginProviderCli } from "./provider-cli-login.js";
import type { ProviderLoginContext } from "./provider-setup-policy.js";

function fixture() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let exit: (value: { code: number; signal: null }) => void = () => {};
  const child = {
    pid: 1,
    stdin,
    stdout,
    stderr,
    hasExited: () => false,
    exited: new Promise<{ code: number; signal: null }>((resolve) => {
      exit = resolve;
    }),
    stop: vi.fn(async () => {
      exit({ code: 0, signal: null });
    }),
  };
  return {
    child,
    spawn: vi.fn(async () => child),
    exit: (code = 0) => exit({ code, signal: null }),
  };
}
function context(signal = new AbortController().signal): ProviderLoginContext {
  return {
    signal,
    method: "default",
    challenge: vi.fn(),
    input: vi.fn(async () => ({ kind: "code" as const, code: "PRIVATE-PASTE" })),
  };
}
it("reassembles split device prompts, strips terminal sequences and requires process success", async () => {
  const f = fixture();
  const ctx = context();
  const done = loginProviderCli("copilot", "/copilot", "/home", {}, ctx, f.spawn);
  await vi.waitFor(() => expect(f.spawn).toHaveBeenCalled());
  f.child.stdout.write("\u001b[32mTo authenticate, visit https://github.com/login/");
  f.child.stdout.write("device and enter code ABCD-1234\n\u001b[0m");
  await vi.waitFor(() =>
    expect(ctx.challenge).toHaveBeenCalledWith(expect.objectContaining({ userCode: "ABCD-1234" })),
  );
  f.exit();
  await done;
  expect(f.child.stop).toHaveBeenCalled();
});
it("submits a pasted authorization code through stdin and never command arguments", async () => {
  const f = fixture();
  const ctx = context();
  ctx.method = "claude-console";
  let input = "";
  f.child.stdin.on("data", (bytes) => {
    input += bytes.toString();
    queueMicrotask(() => f.exit());
  });
  const done = loginProviderCli("claude", "/claude", "/home", {}, ctx, f.spawn);
  await vi.waitFor(() => expect(f.spawn).toHaveBeenCalled());
  f.child.stderr.write(
    "https://platform.claude.com/oauth/authorize?state=private-state\nPaste code here: ",
  );
  await done;
  expect(input).toBe("PRIVATE-PASTE\n");
  expect(JSON.stringify(f.spawn.mock.calls)).not.toContain("PRIVATE-PASTE");
});
it.each(["evil", "oversized", "unknown-prompt", "failed", "cancel"])(
  "rejects %s without forwarding raw output and stops the process",
  async (mode) => {
    const f = fixture();
    const abort = new AbortController();
    const ctx = context(abort.signal);
    const done = loginProviderCli("copilot", "/copilot", "/home", {}, ctx, f.spawn);
    const assertion = expect(done).rejects.toMatchObject({
      reason: mode === "unknown-prompt" ? "unsupported" : mode === "cancel" ? "timeout" : "login",
    });
    await vi.waitFor(() => expect(f.spawn).toHaveBeenCalled());
    if (mode === "evil")
      f.child.stdout.write("https://github.com.evil.test/login/device enter code ABCD-1234\n");
    if (mode === "oversized") f.child.stdout.write("x".repeat(65537));
    if (mode === "unknown-prompt") f.child.stdout.write("Run arbitrary command? [y/n]\n");
    if (mode === "failed") f.exit(3);
    if (mode === "cancel") abort.abort();
    await assertion;
    expect(f.child.stop).toHaveBeenCalled();
    expect(ctx.challenge).toHaveBeenCalledWith(null);
  },
);
it("requires explicit acceptance for Copilot private-file fallback and reports cleanup failure", async () => {
  const f = fixture();
  const ctx = context();
  ctx.input = vi.fn(async () => ({ kind: "confirmation" as const, accepted: false }));
  const done = loginProviderCli("copilot", "/copilot", "/home", {}, ctx, f.spawn);
  const assertion = expect(done).rejects.toMatchObject({ reason: "login" });
  await vi.waitFor(() => expect(f.spawn).toHaveBeenCalled());
  f.child.stdout.write("Store token in plaintext configuration file? [y/n]\n");
  await assertion;
  const g = fixture();
  g.child.stop.mockRejectedValue(new Error("PRIVATE"));
  const failed = loginProviderCli("kiro", "/kiro", "/home", {}, context(), g.spawn);
  const cleanup = expect(failed).rejects.toMatchObject({ reason: "cleanup" });
  await vi.waitFor(() => expect(g.spawn).toHaveBeenCalled());
  g.exit(3);
  await cleanup;
});
