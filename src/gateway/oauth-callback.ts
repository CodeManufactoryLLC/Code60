import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { OAuthCallbackPort } from "../application/index.js";
import { registerPrivateListener } from "../platform/index.js";

/** One attempt, one loopback callback, no shared public listener or persisted authority. */
export const openOAuthCallback: OAuthCallbackPort = async (input) => {
  let origin = "";
  let used = false;
  let settled = false;
  let finish!: (value: { state: string; code?: string; issuer?: string; error?: boolean }) => void;
  let reject!: () => void;
  const result = new Promise<{ state: string; code?: string; issuer?: string; error?: boolean }>(
    (resolve, fail) => {
      finish = resolve;
      reject = () => fail(new Error("OAuth callback cancelled or expired"));
    },
  );
  let completed!: () => void;
  const completion = new Promise<void>((resolve) => {
    completed = resolve;
  });
  void result.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    try {
      if (
        request.method !== "GET" ||
        request.headers.origin ||
        request.headers.host !== new URL(origin).host ||
        !request.url ||
        request.url.length > 8192
      )
        throw new Error();
      const url = new URL(request.url, origin);
      if (url.pathname === "/oauth/done" && used && !url.search) {
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Authorization response received. Return to Code60 to check the result.");
        response.once("finish", () => {
          completed();
          void close().catch(() => {});
        });
        return;
      }
      if (used || input.signal.aborted || url.pathname !== "/oauth/callback") throw new Error();
      const parameters = url.searchParams;
      const keys = [...parameters.keys()];
      if (new Set(keys).size !== keys.length) throw new Error();
      const state = parameters.get("state") ?? "";
      const supplied = Buffer.from(state),
        expected = Buffer.from(input.state);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        throw new Error();
      const issuer = parameters.get("iss");
      if ((issuer !== null && issuer !== input.issuer) || (input.requireIssuer && issuer === null))
        throw new Error();
      const code = parameters.get("code"),
        error = parameters.has("error");
      if (
        (!code && !error) ||
        (code && error) ||
        (code && (code.length > 4096 || /[\0\r\n]/.test(code)))
      )
        throw new Error();
      used = true;
      settled = true;
      finish({
        state,
        ...(code ? { code } : {}),
        ...(issuer ? { issuer } : {}),
        ...(error ? { error: true } : {}),
      });
      response.writeHead(303, { Location: `${origin}/oauth/done` });
      response.end();
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Authorization callback rejected. Return to Code60.");
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("OAuth callback unavailable");
  const unregister = registerPrivateListener(address.port);
  origin = `http://127.0.0.1:${address.port}`;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", abort);
      if (!settled) {
        settled = true;
        reject();
      }
      if (used && !input.signal.aborted) {
        let ending: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            completion,
            new Promise<void>((resolve) => {
              ending = setTimeout(resolve, 2000);
            }),
          ]);
        } finally {
          clearTimeout(ending);
        }
      }
      server.closeAllConnections();
      await new Promise<void>((resolve, fail) =>
        server.close((error) =>
          error && server.listening
            ? fail(new Error("OAuth callback cleanup unresolved"))
            : resolve(),
        ),
      );
      unregister();
    })();
    void closing.catch(() => {
      closing = undefined;
    });
    return closing;
  };
  const abort = () => {
    void close().catch(() => {});
  };
  const timer = setTimeout(abort, 5 * 60 * 1000);
  timer.unref();
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) await close();
  return { redirectUri: `${origin}/oauth/callback`, result, close };
};
