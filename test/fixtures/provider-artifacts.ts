import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import type { ProviderDownload } from "../../src/application/index.js";

export function providerArchive(
  entries: { name: string; content?: string; type?: string; link?: string }[],
) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.content ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, "utf8");
    header.write("0000700\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header.write(entry.type ?? "0", 156);
    if (entry.link) header.write(entry.link, 157, 100, "utf8");
    header.write("ustar\0", 257);
    header.write("00", 263);
    header.write(
      `${header
        .reduce((sum, byte) => sum + byte, 0)
        .toString(8)
        .padStart(6, "0")}\0 `,
      148,
    );
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
/** The external download boundary is synthetic; extraction/activation remain production code. */
export const syntheticProviderDownload: typeof ProviderDownload = async (
  artifact,
  file,
  signal,
) => {
  signal.throwIfAborted();
  const script = await readFile(new URL("./fake-provider-tools.mjs", import.meta.url), "utf8");
  const name = artifact.url.includes("antigravity")
    ? "antigravity"
    : artifact.url.includes("kiro")
      ? "kirocli/bin/kiro-cli"
      : artifact.url.includes("copilot")
        ? "package/copilot"
        : artifact.url.includes("claude-code")
          ? "package/claude"
          : artifact.url.includes("cli-linux") || artifact.url.includes("cli-darwin")
            ? "package/bin/droid"
            : "package/bin/opencode";
  await writeFile(file, providerArchive([{ name, content: script }]));
};
