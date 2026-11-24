import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import type { OwnedProcess } from "../platform/index.js";
import type { ProviderSpawn } from "./provider-cli-login.js";
import {
  type ProviderLoginContext,
  ProviderSetupError,
  validateLoginChallenge,
} from "./provider-setup-policy.js";

const rpcMessage = z.object({
  id: z.union([z.number().int(), z.string().max(128)]).optional(),
  method: z.string().max(128).optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
/** An auth-only RPC transport; it never grants file, terminal or tool permissions. */
async function droidConnection(child: OwnedProcess, context: ProviderLoginContext, cwd: string) {
  let nextId = 0;
  let buffer = "";
  let total = 0;
  let failed: Error | undefined;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const fail = () => {
    failed ??= new ProviderSetupError("login");
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(failed);
    }
    pending.clear();
  };
  const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
  const request = (method: string, params: unknown, wait = 15_000): Promise<unknown> => {
    if (failed || context.signal.aborted) return Promise.reject(new ProviderSetupError("login"));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new ProviderSetupError("timeout"));
      }, wait);
      pending.set(id, { resolve, reject, timer });
      send({ jsonrpc: "2.0", id, method, params });
    });
  };
  const decoder = new StringDecoder("utf8");
  const receive = (bytes: Buffer) => {
    if (failed) return;
    try {
      total += bytes.length;
      if (total > 1024 * 1024) throw new Error();
      buffer += decoder.write(bytes);
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (Buffer.byteLength(line) > 64 * 1024) throw new Error();
        const value = rpcMessage.parse(JSON.parse(line));
        if (typeof value.id === "number" && pending.has(value.id) && !value.method) {
          const item = pending.get(value.id);
          if (!item) continue;
          clearTimeout(item.timer);
          pending.delete(value.id);
          if (value.error !== undefined) item.reject(new ProviderSetupError("login"));
          else item.resolve(value.result);
        } else if (value.method && value.id !== undefined) {
          if (value.method !== "elicitation/create") {
            send({
              jsonrpc: "2.0",
              id: value.id,
              error: { code: -32601, message: "Unavailable during sign-in" },
            });
            continue;
          }
          const challenge = z
            .object({
              mode: z.literal("url"),
              elicitationId: z.string().min(1).max(128),
              requestId: z.number().int(),
              url: z.string().max(8192),
              message: z.string().max(4096).optional(),
            })
            .parse(value.params);
          if (!pending.has(challenge.requestId)) throw new ProviderSetupError("login");
          const code =
            /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(challenge.message ?? "")?.[1] ??
            new URL(challenge.url).searchParams.get("user_code") ??
            new URL(challenge.url).searchParams.get("code");
          context.challenge(
            validateLoginChallenge("droid", {
              kind: code ? "device" : "browser",
              challengeId: randomUUID(),
              verificationUrl: challenge.url,
              ...(code ? { userCode: code } : {}),
            }),
          );
          send({ jsonrpc: "2.0", id: value.id, result: { action: "accept" } });
        }
      }
      if (Buffer.byteLength(buffer) > 64 * 1024) throw new Error();
    } catch {
      fail();
    }
  };
  child.stdout.on("data", receive);
  child.stderr.resume();
  const abort = () => fail();
  context.signal.addEventListener("abort", abort, { once: true });
  void child.exited.then(fail);
  try {
    const init = z
      .object({
        protocolVersion: z.literal(1),
        authMethods: z
          .array(z.object({ id: z.string().max(100) }))
          .max(32)
          .optional(),
      })
      .parse(
        await request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "code60", version: "1" },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
            elicitation: { url: {} },
          },
        }),
      );
    if (init.authMethods?.some((method) => method.id === "device-pairing"))
      await request("authenticate", { methodId: "device-pairing" }, 15 * 60_000);
    else await request("session/new", { cwd, mcpServers: [] }, 15 * 60_000);
    if (failed) throw failed;
  } finally {
    child.stdout.off("data", receive);
    context.signal.removeEventListener("abort", abort);
    fail();
    context.challenge(null);
  }
}
export async function loginDroid(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  context: ProviderLoginContext,
  spawn: ProviderSpawn,
  ownDirectory: (path: string) => void = () => {},
) {
  const directory = await mkdtemp(join(cwd, ".code60-droid-login-"));
  ownDirectory(directory);
  let child: OwnedProcess | undefined;
  let clean = true;
  let outcome: unknown;
  try {
    child = await spawn([executable, "exec", "--output-format", "acp"], directory, env);
    await droidConnection(child, context, directory);
  } catch (error) {
    outcome = error;
  } finally {
    try {
      await child?.stop(1_000);
    } catch {
      clean = false;
    }
    if (clean) await rm(directory, { recursive: true, force: true });
    else outcome = new ProviderSetupError("cleanup");
  }
  if (outcome) throw outcome;
}

async function boundedJson(response: Response) {
  if (!response.ok || !response.body) throw new ProviderSetupError("login");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > 64 * 1024) throw new ProviderSetupError("login");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
/** Bypass ambient HTTP proxy configuration for the private provider password. */
const directLoopbackFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new ProviderSetupError("login");
  return new Promise<Response>((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: init?.method ?? "GET",
        headers: init?.headers as Record<string, string>,
        ...(init?.signal ? { signal: init.signal } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (bytes: Buffer) => {
          total += bytes.length;
          if (total > 64 * 1024) {
            response.destroy();
            reject(new ProviderSetupError("login"));
            return;
          }
          chunks.push(bytes);
        });
        response.on("error", () => reject(new ProviderSetupError("login")));
        response.on("end", () =>
          resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })),
        );
      },
    );
    request.on("error", () => reject(new ProviderSetupError("login")));
    request.end(typeof init?.body === "string" ? init.body : undefined);
  });
};
export async function loginOpenCode(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  context: ProviderLoginContext,
  spawn: ProviderSpawn,
  fetcher: typeof fetch = directLoopbackFetch,
  ownDirectory: (path: string) => void = () => {},
) {
  const directory = await mkdtemp(join(cwd, ".code60-opencode-login-"));
  ownDirectory(directory);
  const password = randomBytes(32).toString("hex");
  let child: OwnedProcess | undefined;
  let clean = true;
  let outcome: unknown;
  try {
    child = await spawn(
      [executable, "serve", "--hostname", "127.0.0.1", "--port", "0", "--mdns=false"],
      directory,
      {
        ...env,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_SERVER_USERNAME: "code60",
        OPENCODE_PURE: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_EMBEDDED_WEB_UI: "1",
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "0",
      },
    );
    const process = child;
    let receive: (bytes: Buffer) => void = () => {};
    let abort = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const origin = await new Promise<string>((resolve, reject) => {
      let text = "";
      const fail = () => reject(new ProviderSetupError("login"));
      receive = (bytes) => {
        text += bytes.toString("utf8");
        if (text.length > 4096) {
          fail();
          return;
        }
        const match =
          /opencode server listening on (http:\/\/127\.0\.0\.1:([0-9]{1,5}))(?=\s|$)/.exec(text);
        if (match && Number(match[2]) > 0 && Number(match[2]) <= 65535) resolve(match[1] as string);
      };
      process.stdout.on("data", receive);
      process.stderr.resume();
      abort = fail;
      context.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(fail, 15_000);
      void process.exited.then(fail);
      if (context.signal.aborted) fail();
    }).finally(() => {
      process.stdout.off("data", receive);
      process.stdout.resume();
      clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
    });
    const headers = {
      Authorization: `Basic ${Buffer.from(`code60:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
      "x-opencode-directory": directory,
    };
    const call = async (path: string, body?: unknown, authorizationWait = false) =>
      boundedJson(
        await fetcher(`${origin}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "error",
          signal: authorizationWait
            ? context.signal
            : AbortSignal.any([context.signal, AbortSignal.timeout(15_000)]),
        }),
      );
    const provider = context.method === "chatgpt" ? "openai" : "github-copilot";
    const methods = z
      .record(
        z.string(),
        z.array(z.object({ type: z.string(), label: z.string().max(200) })).max(32),
      )
      .parse(await call("/provider/auth"));
    const index =
      methods[provider]?.findIndex(
        (method) =>
          method.type === "oauth" &&
          method.label ===
            (provider === "openai" ? "ChatGPT Pro/Plus (headless)" : "Login with GitHub Copilot"),
      ) ?? -1;
    if (index < 0) throw new ProviderSetupError("unsupported");
    const authorization = z
      .object({
        url: z.string().max(8192),
        method: z.literal("auto"),
        instructions: z.string().max(4096),
      })
      .parse(
        await call(`/provider/${provider}/oauth/authorize`, {
          method: index,
          ...(provider === "github-copilot" ? { inputs: { deploymentType: "github.com" } } : {}),
        }),
      );
    const code = /^Enter code: ([A-Za-z0-9-]{1,128})$/.exec(authorization.instructions)?.[1];
    if (!code) throw new ProviderSetupError("login");
    context.challenge(
      validateLoginChallenge("opencode", {
        kind: "device",
        challengeId: randomUUID(),
        userCode: code,
        verificationUrl: authorization.url,
      }),
    );
    if ((await call(`/provider/${provider}/oauth/callback`, { method: index }, true)) !== true)
      throw new ProviderSetupError("login");
  } catch (error) {
    outcome = error instanceof ProviderSetupError ? error : new ProviderSetupError("login");
  } finally {
    context.challenge(null);
    try {
      await child?.stop(1_000);
    } catch {
      clean = false;
    }
    if (clean) await rm(directory, { recursive: true, force: true });
    else outcome = new ProviderSetupError("cleanup");
  }
  if (outcome) throw outcome;
}
