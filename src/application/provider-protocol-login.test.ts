import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { loginDroid, loginOpenCode } from "./provider-protocol-login.js";
import type { ProviderLoginContext } from "./provider-setup-policy.js";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function home() {
  const value = await mkdtemp(join(tmpdir(), "code60-provider-protocol-"));
  homes.push(value);
  return value;
}
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
    stop: vi.fn(async () => exit({ code: 0, signal: null })),
  };
  const send = (value: unknown) => stdout.write(`${JSON.stringify(value)}\n`);
  return { child, send, spawn: vi.fn(async (..._args: unknown[]) => child) };
}
function context(signal = new AbortController().signal): ProviderLoginContext {
  return { signal, method: "default", challenge: vi.fn(), input: vi.fn() };
}
it.each(["evil", "malformed", "oversized", "cancel"])(
  "rejects Droid %s protocol input, never grants capabilities and cleans up",
  async (mode) => {
    const directory = await home();
    const f = fixture();
    const abort = new AbortController();
    const ctx = context(abort.signal);
    const done = loginDroid("/droid", directory, {}, ctx, f.spawn);
    const assertion = expect(done).rejects.toMatchObject({ reason: "login" });
    const requests: string[] = [];
    f.child.stdin.on("data", (bytes) => {
      const request = JSON.parse(bytes.toString());
      requests.push(request.method);
      if (request.method === "initialize")
        queueMicrotask(() => {
          expect(request.params.clientCapabilities).toMatchObject({
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
            elicitation: { url: {} },
          });
          if (mode === "evil")
            f.send({
              id: "auth",
              method: "elicitation/create",
              params: { mode: "url", url: "https://evil.test/?secret", message: "ABCD-1234" },
            });
          if (mode === "malformed") f.child.stdout.write("not json\n");
          if (mode === "oversized") f.child.stdout.write("x".repeat(65537));
          if (mode === "cancel") abort.abort();
        });
    });
    await assertion;
    expect(requests).not.toContain("session/prompt");
    expect(f.child.stop).toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
    expect(ctx.challenge).toHaveBeenCalledWith(null);
  },
);
it("rejects malformed OpenCode authorization and limits requests to the private auth API", async () => {
  const directory = await home();
  const f = fixture();
  const ctx = context();
  ctx.method = "chatgpt";
  const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) });
    if (String(url).endsWith("/provider/auth"))
      return Response.json({ openai: [{ type: "oauth", label: "ChatGPT Pro/Plus (headless)" }] });
    return Response.json({
      method: "auto",
      url: "https://evil.test/login",
      instructions: "Enter code: ABCD-1234",
    });
  });
  const done = loginOpenCode("/opencode", directory, {}, ctx, f.spawn, fetcher);
  const assertion = expect(done).rejects.toMatchObject({ reason: "login" });
  await vi.waitFor(() => expect(f.spawn).toHaveBeenCalled());
  f.child.stdout.write("opencode server listening on http://127.0.0.1:12345\n");
  await assertion;
  expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    "/provider/auth",
    "/provider/openai/oauth/authorize",
  ]);
  expect(ctx.challenge).toHaveBeenCalledWith(null);
  expect(f.spawn.mock.calls[0]?.[2]).toMatchObject({
    OPENCODE_PURE: "1",
    OPENCODE_DISABLE_EMBEDDED_WEB_UI: "1",
  });
  expect(await readdir(directory)).toEqual([]);
});
it("stops an OpenCode server when its owner cancels before startup completes", async () => {
  const directory = await home();
  const f = fixture();
  const abort = new AbortController();
  const done = loginOpenCode("/opencode", directory, {}, context(abort.signal), f.spawn);
  const assertion = expect(done).rejects.toMatchObject({ reason: "login" });
  await vi.waitFor(() => expect(f.spawn).toHaveBeenCalled());
  abort.abort();
  await assertion;
  expect(f.child.stop).toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});
