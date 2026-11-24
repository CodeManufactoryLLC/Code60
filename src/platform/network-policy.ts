import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

class NetworkFailure extends Error {
  readonly code: string;
  constructor(message = "Network destination rejected", error?: unknown) {
    super(message);
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    // Carry only reviewed native codes. Drop raw exceptions, destinations and payloads.
    this.code =
      typeof code === "string" &&
      [
        "ECONNREFUSED",
        "ECONNRESET",
        "ENOTFOUND",
        "EAI_AGAIN",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "ETIMEDOUT",
        "CERT_HAS_EXPIRED",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "ERR_TLS_CERT_ALTNAME_INVALID",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "ERR_MCP_NETWORK_LIMIT",
      ].includes(code)
        ? code
        : "ERR_MCP_NETWORK";
  }
}

const privateListeners = new Map<number, number>();
/** Register application-private TCP listeners for their actual lifetime. */
export function registerPrivateListener(port: number) {
  privateListeners.set(port, (privateListeners.get(port) ?? 0) + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const count = (privateListeners.get(port) ?? 1) - 1;
    if (count) privateListeners.set(port, count);
    else privateListeners.delete(port);
  };
}
function normalized(address: string): string {
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return "";
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (canonical.startsWith("::ffff:")) {
    const pieces = canonical
      .slice(7)
      .split(":")
      .map((part) => Number.parseInt(part, 16));
    if (pieces.length !== 2) return "";
    const [hi = 0, lo = 0] = pieces;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return canonical;
}
export function networkAddressClass(address: string): "public" | "private" | "blocked" {
  const value = normalized(address);
  if (isIP(value) === 4) {
    const [a = -1, b = -1, c = -1, d = -1] = value.split(".").map(Number);
    if (
      a === 0 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      value === "100.100.100.200" ||
      (a === 192 && b === 0 && c === 0)
    )
      return "blocked";
    if (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    )
      return "private";
    if ([a, b, c, d].some((part) => part < 0 || part > 255)) return "blocked";
    return "public";
  }
  if (
    isIP(value) !== 6 ||
    value === "::" ||
    value.startsWith("ff") ||
    /^fe[89ab]/.test(value) ||
    value === "fd00:ec2::254"
  )
    return "blocked";
  if (value === "::1" || /^f[cd]/.test(value) || /^fe[cdef]/.test(value)) return "private";
  if (
    value.startsWith("::") ||
    value.startsWith("2002:") ||
    value.startsWith("2001:0:") ||
    value.startsWith("64:ff9b:")
  )
    return "blocked";
  return "public";
}
const loopback = (address: string) => {
  const value = normalized(address);
  return value.startsWith("127.") || value === "::1";
};
export interface GuardedNetworkOptions {
  privateOrigins?: readonly string[];
  maximumBytes?: number;
  timeoutMs?: number;
  redirects?: number;
  lookup?: (
    hostname: string,
    options: { all: true; verbatim: true },
  ) => Promise<{ address: string; family: number }[]>;
  streaming?: boolean;
  credentials?: boolean;
}
function parseUrl(value: string | URL, base?: URL) {
  try {
    const url = new URL(value, base?.href);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new NetworkFailure();
    return url;
  } catch {
    throw new NetworkFailure("Network destination rejected");
  }
}
async function destination(url: URL, options: GuardedNetworkOptions, signal: AbortSignal) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  let abort: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new NetworkFailure("Network request cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await Promise.race([
          options.lookup
            ? options.lookup(host, { all: true, verbatim: true })
            : lookup(host, { all: true, verbatim: true }),
          cancelled,
        ]);
    if (
      !addresses.length ||
      addresses.length > 64 ||
      addresses.some(
        ({ address }) =>
          networkAddressClass(address) === "blocked" ||
          (loopback(address) && privateListeners.has(port)) ||
          (networkAddressClass(address) === "private" &&
            !(options.privateOrigins ?? []).includes(url.origin)),
      )
    )
      throw new NetworkFailure("Network destination requires approval or is blocked");
    return {
      selected: addresses[0]!,
      port,
      loopback: addresses.every(({ address }) => loopback(address)),
    };
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}
/** Direct sockets bypass proxies; vet DNS, pin the result and verify the connected peer. */
export function guardedFetch(options: GuardedNetworkOptions = {}): typeof fetch {
  const maximum = options.maximumBytes ?? 1024 * 1024;
  return async (input, init) => {
    const original = input instanceof Request ? input : undefined;
    let url = parseUrl(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers ?? original?.headers);
    const method = (init?.method ?? original?.method ?? "GET").toUpperCase();
    const body = init?.body ?? (original ? await original.text() : undefined);
    if (
      body !== undefined &&
      body !== null &&
      typeof body !== "string" &&
      !(body instanceof Uint8Array)
    )
      throw new NetworkFailure("Network request body rejected");
    if (body && Buffer.byteLength(body) > maximum)
      throw new NetworkFailure("Network request limit reached", { code: "ERR_MCP_NETWORK_LIMIT" });
    const parent = init?.signal ?? original?.signal;
    const sensitive =
      options.credentials ||
      headers.has("authorization") ||
      headers.has("proxy-authorization") ||
      headers.has("cookie");
    for (let redirect = 0; ; redirect++) {
      const deadline = new AbortController();
      const timer =
        options.timeoutMs === 0
          ? undefined
          : setTimeout(() => deadline.abort(), options.timeoutMs ?? 30_000);
      timer?.unref();
      const signal = AbortSignal.any([...(parent ? [parent] : []), deadline.signal]);
      let response: Response;
      try {
        signal.throwIfAborted();
        const { selected, port, loopback: isLoopback } = await destination(url, options, signal);
        if (sensitive && url.protocol !== "https:" && !isLoopback)
          throw new NetworkFailure("Credentials require HTTPS except loopback");
        response = await new Promise<Response>((resolve, reject) => {
          let responded = false;
          const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
            url,
            {
              method,
              headers: Object.fromEntries(headers),
              agent: false,
              signal,
              rejectUnauthorized: true,
              family: selected.family,
              lookup: (_name, _settings, callback) =>
                callback(null, selected.address, selected.family),
            },
            (incoming) => {
              responded = true;
              if (options.streaming) clearTimeout(timer);
              const finish = () => clearTimeout(timer);
              incoming.once("end", finish);
              incoming.once("close", finish);
              incoming.once("error", finish);
              const rawHeaders = new Headers();
              for (const [key, value] of Object.entries(incoming.headers)) {
                if (Array.isArray(value)) for (const item of value) rawHeaders.append(key, item);
                else if (value !== undefined) rawHeaders.set(key, value);
              }
              let bytes = 0;
              incoming.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > maximum)
                  incoming.destroy(
                    new NetworkFailure("Network response limit reached", {
                      code: "ERR_MCP_NETWORK_LIMIT",
                    }),
                  );
              });
              const status = incoming.statusCode ?? 502;
              const stream =
                [204, 205, 304].includes(status) || method === "HEAD"
                  ? null
                  : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
              resolve(new Response(stream, { status, headers: rawHeaders }));
              if (!stream) incoming.resume();
            },
          );
          request.on("socket", (socket) =>
            socket.once("connect", () => {
              if (
                !socket.remoteAddress ||
                normalized(socket.remoteAddress) !== normalized(selected.address) ||
                socket.remotePort !== port ||
                (loopback(socket.remoteAddress) && privateListeners.has(port))
              )
                request.destroy(new NetworkFailure("Network socket identity changed"));
            }),
          );
          request.once("close", () => {
            if (!responded) {
              clearTimeout(timer);
              reject(new NetworkFailure("Network request failed or outcome is uncertain"));
            }
          });
          request.once("error", (error) => {
            clearTimeout(timer);
            reject(new NetworkFailure("Network request failed or outcome is uncertain", error));
          });
          request.end(body);
        });
      } catch (error) {
        clearTimeout(timer);
        if (deadline.signal.aborted && !parent?.aborted)
          throw new NetworkFailure("Network request timed out or outcome is uncertain", {
            code: "ETIMEDOUT",
          });
        if (error instanceof NetworkFailure) throw error;
        throw new NetworkFailure("Network request failed or outcome is uncertain", error);
      }
      if (response.status < 300 || response.status > 399 || response.status === 304)
        return response;
      const location = response.headers.get("location");
      await response.body?.cancel();
      clearTimeout(timer);
      if (
        !location ||
        redirect >= (options.redirects ?? 0) ||
        !["GET", "HEAD"].includes(method) ||
        sensitive
      )
        throw new NetworkFailure("Network redirect rejected");
      const next = parseUrl(location, url);
      if (url.protocol === "https:" && next.protocol !== "https:")
        throw new NetworkFailure("Network redirect rejected");
      headers.delete("authorization");
      headers.delete("cookie");
      headers.delete("proxy-authorization");
      url = next;
    }
  };
}
