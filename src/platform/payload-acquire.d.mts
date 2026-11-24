import type { Readable } from "node:stream";
import type { PayloadDescriptor, PayloadHost } from "./payload-descriptor.mjs";

export type PayloadTransport = (
  url: string,
  options: { signal?: AbortSignal | undefined },
) => Promise<Readable | ReadableStream<Uint8Array>> | Readable | ReadableStream<Uint8Array>;
export function sha256(path: string, signal?: AbortSignal): Promise<string>;
export function releaseTransport(
  url: string,
  options?: { signal?: AbortSignal | undefined },
): Promise<ReadableStream<Uint8Array>>;
export function acquirePayload(
  value: unknown,
  options: {
    parent: string;
    signal?: AbortSignal;
    transport?: PayloadTransport;
    host?: PayloadHost;
    remove?: typeof import("node:fs/promises").rm;
    timeout?: number;
  },
): Promise<{ root: string; owned: string; descriptor: PayloadDescriptor }>;
