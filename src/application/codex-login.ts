import { z } from "zod";
import { type CodexChallenge, codexChallengeSchema } from "../bridge/index.js";
import { type OwnedProcess, spawnOwnedProcess } from "../platform/index.js";

export type CodexFailure = "missing" | "unsupported" | "install" | "login" | "timeout" | "cleanup";
const messages: Record<CodexFailure, string> = {
  missing: "Install Codex to sign in from Code60.",
  unsupported:
    "This Codex version does not support device-code sign-in. Install the compatible version for Code60.",
  install: "Codex installation failed. Check your connection and npm availability, then retry.",
  login:
    "Codex sign-in did not complete. Check that device-code login is enabled in your ChatGPT security settings, then retry.",
  timeout: "Codex setup timed out. Retry to continue.",
  cleanup:
    "Codex setup could not finish process cleanup. Retry after the owned process has stopped.",
};
export class CodexSetupError extends Error {
  constructor(readonly reason: CodexFailure) {
    super(messages[reason]);
  }
}

const messageSchema = z.object({
  id: z.number().int().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const startSchema = codexChallengeSchema.extend({
  type: z.literal("chatgptDeviceCode"),
  loginId: z.uuid(),
});
const completionSchema = z.object({ loginId: z.uuid(), success: z.boolean() });

/** Authentication only. No threads, model requests, credentials or raw process output escape this client. */
export async function loginCodex(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  challenge: (value: CodexChallenge) => void,
  options: {
    spawn?: typeof spawnOwnedProcess;
    requestMs?: number;
    loginMs?: number;
    release?: (process: OwnedProcess) => Promise<void>;
  } = {},
): Promise<void> {
  const timeout = AbortSignal.timeout(options.loginMs ?? 15 * 60_000);
  const combined = AbortSignal.any([signal, timeout]);
  combined.throwIfAborted();
  let child: OwnedProcess;
  try {
    child = await (options.spawn ?? spawnOwnedProcess)(
      [executable, "app-server", "--listen", "stdio://"],
      cwd,
      env,
    );
  } catch {
    throw new CodexSetupError("missing");
  }
  let buffer = "";
  let total = 0;
  let nextId = 0;
  let loginId: string | undefined;
  let stopping = false;
  let failure: Error | undefined;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const completions = new Map<string, boolean>();
  let completed: (() => void) | undefined;
  const finish = new Promise<void>((resolve) => {
    completed = resolve;
  });
  const fail = (error: Error) => {
    failure ??= error;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(failure);
    }
    pending.clear();
    completed?.();
  };
  const receive = (bytes: Buffer) => {
    if (stopping || failure) return;
    total += bytes.length;
    if (total > 1024 * 1024) return fail(new CodexSetupError("login"));
    buffer += bytes.toString("utf8");
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const line = buffer.slice(0, end);
      if (Buffer.byteLength(line) > 64 * 1024) return fail(new CodexSetupError("login"));
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const value = messageSchema.parse(JSON.parse(line));
        if (value.id !== undefined && pending.has(value.id)) {
          const request = pending.get(value.id);
          if (!request) continue;
          pending.delete(value.id);
          clearTimeout(request.timer);
          if (value.error !== undefined) {
            const code = z.object({ code: z.number() }).safeParse(value.error);
            request.reject(
              new CodexSetupError(
                code.success && [-32601, -32602].includes(code.data.code) ? "unsupported" : "login",
              ),
            );
          } else request.resolve(value.result);
        } else if (value.method === "account/login/completed") {
          const result = completionSchema.parse(value.params);
          if (completions.size >= 8) return fail(new CodexSetupError("login"));
          completions.set(result.loginId, result.success);
          if (result.loginId === loginId) completed?.();
        } else if (value.id !== undefined && value.method !== undefined) {
          // This client provides no command, filesystem, approval or token-refresh capabilities.
          child.stdin.write(
            `${JSON.stringify({ id: value.id, error: { code: -32601, message: "Unsupported method" } })}\n`,
          );
        }
      } catch {
        fail(new CodexSetupError("login"));
      }
    }
    if (Buffer.byteLength(buffer) > 64 * 1024) fail(new CodexSetupError("login"));
  };
  const abort = () => fail(new CodexSetupError(timeout.aborted ? "timeout" : "login"));
  const request = (method: string, params: unknown): Promise<unknown> => {
    if (failure) return Promise.reject(failure);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => fail(new CodexSetupError("timeout")),
        options.requestMs ?? 15_000,
      );
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (error) fail(new CodexSetupError("login"));
      });
    });
  };
  child.stdout.on("data", receive);
  child.stdout.on("error", abort);
  child.stderr.resume();
  void child.exited.then(() => {
    if (!stopping) fail(new CodexSetupError(loginId ? "login" : "unsupported"));
  }, abort);
  combined.addEventListener("abort", abort, { once: true });
  if (combined.aborted) abort();
  let outcome: Error | undefined;
  try {
    await request("initialize", {
      clientInfo: { name: "code60", title: "Code60 provider setup", version: "1" },
    });
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    const start = startSchema.parse(
      await request("account/login/start", { type: "chatgptDeviceCode" }),
    );
    loginId = start.loginId;
    if (failure) throw failure;
    combined.throwIfAborted();
    challenge(
      codexChallengeSchema.parse({
        verificationUrl: start.verificationUrl,
        userCode: start.userCode,
      }),
    );
    if (!completions.has(loginId)) await finish;
    if (failure) throw failure;
    if (!completions.get(loginId)) throw new CodexSetupError("login");
    combined.throwIfAborted();
  } catch (error) {
    outcome =
      error instanceof CodexSetupError
        ? error
        : new CodexSetupError(timeout.aborted ? "timeout" : "login");
  } finally {
    stopping = true;
    combined.removeEventListener("abort", abort);
    child.stdout.removeListener("data", receive);
    if (loginId && (combined.aborted || failure) && !child.hasExited())
      child.stdin.write(
        `${JSON.stringify({ id: nextId++, method: "account/login/cancel", params: { loginId } })}\n`,
      );
    for (const request of pending.values()) clearTimeout(request.timer);
    try {
      await (options.release ? options.release(child) : child.stop(1_000));
    } catch {
      outcome = new CodexSetupError("cleanup");
    }
  }
  if (outcome) throw outcome;
}
