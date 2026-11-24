import { credentialRequestSchema } from "./credential-protocol.js";

// Native code lives only in this bounded child. Neither arguments nor its environment
// carry secret material. No OS credential enumeration or alternate store is available.
async function main() {
  if (!["darwin", "linux"].includes(process.platform)) throw new Error();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) throw new Error();
    chunks.push(chunk);
  }
  const request = credentialRequestSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))),
  );
  const { AsyncEntry } = await import("@napi-rs/keyring");
  const entry = new AsyncEntry(request.service, request.account, {
    linux: { store: "secret-service" },
  });
  const signal = AbortSignal.timeout(8000);
  if (request.action === "set") await entry.setPassword(request.secret, signal);
  if (request.action === "delete") await entry.deleteCredential(signal);
  const secret = request.action === "get" ? await entry.getPassword(signal) : undefined;
  if (secret !== undefined && secret !== null && Buffer.byteLength(secret) > 128 * 1024)
    throw new Error();
  process.stdout.write(
    JSON.stringify({ status: "available", ...(request.action === "get" ? { secret } : {}) }),
  );
}
void main().catch((error: unknown) => {
  // Classify only; never serialize native exceptions, which can contain private data.
  const description = error instanceof Error ? error.message.toLowerCase() : "";
  const status = /locked|unlock prompt|interaction.*not.*allowed|denied/.test(description)
    ? "locked"
    : /dbus|secret service|secret-service|not available|unavailable|not running|module|cannot find|default keychain could not be found|backend/.test(
          description,
        )
      ? "unavailable"
      : "uncertain";
  process.stdout.write(JSON.stringify({ status }));
});
