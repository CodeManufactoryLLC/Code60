export interface PayloadDescriptor {
  schemaVersion: 1;
  version: string;
  commit: string;
  dirty: boolean;
  os: "darwin" | "linux";
  arch: "arm64" | "x64";
  runtime: { node: string; libc: "glibc" | null };
  archive: { name: string; size: number; sha256: string; url: string };
}
export interface PayloadHost {
  platform: string;
  arch: string;
  versions: { node: string };
  report: { getReport(): object };
}
export const limits: Readonly<{
  download: number;
  expanded: number;
  entries: number;
  path: number;
}>;
export const targets: readonly string[];
export const nodeRange: string;
export function platform(host?: PayloadHost): string;
export function descriptor(value: unknown): PayloadDescriptor;
export function descriptorPair(
  values: unknown[],
  version: string,
): Record<string, PayloadDescriptor>;
