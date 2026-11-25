export interface PayloadArchiveEntry {
  path: string;
  size: number;
  mode: number;
  type: "0" | "2" | "5";
  link: string;
  offset: number;
}
export function writeArchive(
  root: string,
  destination: string,
  options?: { signal?: AbortSignal; level?: number },
): Promise<void>;
export function extractArchive(
  archive: string,
  destination: string,
  temporary: string,
  options?: { signal?: AbortSignal; bounds?: { expanded: number; entries: number } },
): Promise<PayloadArchiveEntry[]>;
