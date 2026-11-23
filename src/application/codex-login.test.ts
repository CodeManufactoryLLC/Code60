import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { CODEX_VERIFICATION_URL } from "../bridge/index.js";
import type { OwnedProcess } from "../platform/index.js";
import { loginCodex } from "./codex-login.js";

const id = "01900000-0000-4000-8000-000000000001";
function processFixture(mode = "wait") {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let exited!: (value: { code: number; signal: null }) => void;
  const requests: { id?: number; method: string; params?: unknown }[] = [];
  const send = (value: unknown) => stdout.write(`${JSON.stringify(value)}\n`);
  const child: OwnedProcess = {
    pid: 1,
    stdin,
    stdout,
    stderr,
    exited: new Promise((done) => {
      exited = done;
    }),
    hasExited: () => false,
    stop: vi.fn(async () => {
      exited({ code: 0, signal: null });
    }),
  };
  stdin.on("data", (bytes) => {
    const request = JSON.parse(bytes.toString());
    requests.push(request);
    queueMicrotask(() => {
      if (request.method === "initialize") send({ id: request.id, result: {} });
      if (request.method === "account/login/start") {
        if (mode === "unsupported")
          return send({
            id: request.id,
            error: { code: -32601, message: "private-provider-output" },
          });
        if (mode === "hang") return;
        if (mode === "malformed") return stdout.write("not JSON\n");
        send({
          id: request.id,
          result: {
            type: "chatgptDeviceCode",
            loginId: id,
            verificationUrl: mode === "evil" ? "https://evil.example/" : CODEX_VERIFICATION_URL,
            userCode: "ABCD-1234",
          },
        });
        if (mode === "early")
          send({ method: "account/login/completed", params: { loginId: id, success: true } });
      }
    });
  });
  return { child, requests, send, spawn: vi.fn(async () => child) };
}
it("uses only structured device-code authentication and waits for the matching completion", async () => {
  const fixture = processFixture();
  const challenge = vi.fn();
  const done = loginCodex("/codex", "/home", {}, new AbortController().signal, challenge, {
    spawn: fixture.spawn,
  });
  await vi.waitFor(() =>
    expect(challenge).toHaveBeenCalledWith({
      verificationUrl: CODEX_VERIFICATION_URL,
      userCode: "ABCD-1234",
    }),
  );
  fixture.send({
    method: "account/login/completed",
    params: { loginId: crypto.randomUUID(), success: true },
  });
  expect(fixture.child.stop).not.toHaveBeenCalled();
  fixture.send({ method: "account/login/completed", params: { loginId: id, success: true } });
  await done;
  expect(fixture.requests.map((value) => value.method)).toEqual([
    "initialize",
    "initialized",
    "account/login/start",
  ]);
  expect(fixture.child.stop).toHaveBeenCalledWith(1000);
});
it.each(["evil", "malformed", "unsupported", "hang"])(
  "rejects %s output without echoing provider content",
  async (mode) => {
    const fixture = processFixture(mode);
    const challenge = vi.fn();
    await expect(
      loginCodex("/codex", "/home", {}, new AbortController().signal, challenge, {
        spawn: fixture.spawn,
        requestMs: 20,
      }),
    ).rejects.toMatchObject({
      reason: mode === "unsupported" ? "unsupported" : mode === "hang" ? "timeout" : "login",
    });
    expect(challenge).not.toHaveBeenCalled();
    expect(fixture.child.stop).toHaveBeenCalledOnce();
  },
);
it("handles immediate completion and cancellation with bounded owned cleanup", async () => {
  const early = processFixture("early");
  await loginCodex("/codex", "/home", {}, new AbortController().signal, () => {}, {
    spawn: early.spawn,
  });
  const fixture = processFixture();
  const abort = new AbortController();
  const challenge = vi.fn();
  const done = loginCodex("/codex", "/home", {}, abort.signal, challenge, { spawn: fixture.spawn });
  await vi.waitFor(() => expect(challenge).toHaveBeenCalled());
  abort.abort();
  await expect(done).rejects.toMatchObject({ reason: "login" });
  expect(fixture.requests.at(-1)).toMatchObject({
    method: "account/login/cancel",
    params: { loginId: id },
  });
  expect(fixture.child.stop).toHaveBeenCalledOnce();
});
it("rejects oversized output, failed login and cleanup failure", async () => {
  const fixture = processFixture();
  const challenge = vi.fn();
  const done = loginCodex("/codex", "/home", {}, new AbortController().signal, challenge, {
    spawn: fixture.spawn,
  });
  await vi.waitFor(() => expect(challenge).toHaveBeenCalled());
  fixture.child.stdout.emit("data", Buffer.alloc(65537, 120));
  await expect(done).rejects.toMatchObject({ reason: "login" });
  const failed = processFixture();
  const observed = vi.fn();
  const failure = loginCodex("/codex", "/home", {}, new AbortController().signal, observed, {
    spawn: failed.spawn,
  });
  await vi.waitFor(() => expect(observed).toHaveBeenCalled());
  failed.send({
    method: "account/login/completed",
    params: { loginId: id, success: false, error: "Bearer never-return-this" },
  });
  await expect(failure).rejects.not.toThrow("never-return-this");
  const bad = processFixture("early");
  vi.mocked(bad.child.stop).mockRejectedValueOnce(new Error("private-cleanup"));
  await expect(
    loginCodex("/codex", "/home", {}, new AbortController().signal, () => {}, { spawn: bad.spawn }),
  ).rejects.toMatchObject({ reason: "cleanup" });
});
it("expires an unanswered device challenge and stops the owned app-server", async () => {
  const fixture = processFixture();
  const challenge = vi.fn();
  await expect(
    loginCodex("/codex", "/home", {}, new AbortController().signal, challenge, {
      spawn: fixture.spawn,
      loginMs: 20,
    }),
  ).rejects.toMatchObject({ reason: "timeout" });
  expect(challenge).toHaveBeenCalledOnce();
  expect(fixture.requests.at(-1)?.method).toBe("account/login/cancel");
  expect(fixture.child.stop).toHaveBeenCalledOnce();
});
