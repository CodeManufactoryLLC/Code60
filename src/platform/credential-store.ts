import { fileURLToPath } from "node:url";
import {
  type CredentialStorePort,
  credentialRequestSchema,
  credentialResponseSchema,
} from "./credential-protocol.js";
import { spawnOwnedProcess } from "./process.js";

/** One native operation per isolated process; uncertain writes never become temporary. */
export function nativeCredentialStore(
  environment: Readonly<NodeJS.ProcessEnv>,
  helper = fileURLToPath(new URL("./credential-helper.js", import.meta.url)),
): CredentialStorePort {
  const env = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] =>
        [
          "PATH",
          "HOME",
          "USER",
          "LOGNAME",
          "TMPDIR",
          "LANG",
          "LC_ALL",
          "DBUS_SESSION_BUS_ADDRESS",
          "XDG_RUNTIME_DIR",
          "XDG_CONFIG_HOME",
          "XDG_DATA_HOME",
        ].includes(entry[0]) && entry[1] !== undefined,
    ),
  );
  const owned = new Set<Awaited<ReturnType<typeof spawnOwnedProcess>>>();
  const pending = new Set<Promise<Awaited<ReturnType<CredentialStorePort>>>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const perform: CredentialStorePort = async (value, signal) => {
    const parsed = credentialRequestSchema.safeParse(value);
    if (!parsed.success) return { status: "uncertain" };
    const request = parsed.data;
    if (closed) return { status: request.action === "get" ? "unavailable" : "uncertain" };
    let child: Awaited<ReturnType<typeof spawnOwnedProcess>> | undefined;
    try {
      signal?.throwIfAborted();
      child = await spawnOwnedProcess(
        [process.execPath, helper],
        fileURLToPath(new URL(".", import.meta.url)),
        env,
      );
      owned.add(child);
      if (closed) throw new Error();
      child.stderr.resume();
      const processHandle = child;
      let output = Buffer.alloc(0);
      const result = new Promise<unknown>((resolve, reject) => {
        processHandle.stdout.on("data", (chunk: Buffer) => {
          if (output.length + chunk.length > 256 * 1024) reject(new Error());
          else output = Buffer.concat([output, chunk]);
        });
        processHandle.stdout.on("error", reject);
        const ended = new Promise<void>((done) => processHandle.stdout.once("end", done));
        void Promise.all([processHandle.exited, ended]).then(([exit]) => {
          try {
            if (exit.code !== 0) throw new Error();
            resolve(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output)));
          } catch {
            reject(new Error());
          }
        });
        processHandle.stdin.end(JSON.stringify(request));
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      try {
        const cancelled = new Promise<never>((_, reject) => {
          abort = () => reject(new Error());
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
        });
        const response = await Promise.race([
          result,
          cancelled,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error()), 10_000);
          }),
        ]);
        await child.stop(100);
        owned.delete(child);
        const parsedResponse = credentialResponseSchema.parse(response);
        if (request.action !== "get" && "secret" in parsedResponse) throw new Error();
        return parsedResponse;
      } finally {
        clearTimeout(timer);
        if (abort) signal?.removeEventListener("abort", abort);
      }
    } catch {
      if (child) {
        try {
          await child.stop(100);
          owned.delete(child);
        } catch {
          return { status: "uncertain" };
        }
      }
      return { status: request.action === "get" ? "unavailable" : "uncertain" };
    }
  };
  const call: CredentialStorePort = (value, signal) => {
    const result = perform(value, signal);
    pending.add(result);
    void result.finally(() => pending.delete(result)).catch(() => {});
    return result;
  };
  call.close = () => {
    closed = true;
    closing ??= (async () => {
      await Promise.allSettled([...owned].map((child) => child.stop(100)));
      await Promise.allSettled([...pending]);
      const results = await Promise.allSettled(
        [...owned].map(async (child) => {
          await child.stop(100);
          owned.delete(child);
        }),
      );
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Native credential helper cleanup remains unresolved");
    })();
    void closing.catch(() => {
      closing = undefined;
    });
    return closing;
  };
  return call;
}
