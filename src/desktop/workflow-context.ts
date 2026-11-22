import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";

export async function workflowDirectoryIdentity(path: string): Promise<string> {
  const canonical = await realpath(path);
  const stat = await lstat(canonical, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Workflow directory is unavailable");
  return `${canonical}:${stat.dev}:${stat.ino}`;
}
async function excerpt(root: string, name: string): Promise<string | null> {
  const path = join(root, name);
  const before = await lstat(path, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!before) return null;
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error("Unsafe repository context file");
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const start = await file.stat({ bigint: true });
    if (before.dev !== start.dev || before.ino !== start.ino)
      throw new Error("Repository context changed");
    const buffer = Buffer.alloc(32_768);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const end = await file.stat({ bigint: true });
    const entry = await lstat(path, { bigint: true });
    if (start.ctimeNs !== end.ctimeNs || entry.ino !== start.ino || entry.dev !== start.dev)
      throw new Error("Repository context changed");
    return (
      buffer.subarray(0, bytesRead).toString("utf8") +
      (start.size > BigInt(bytesRead) ? "\n[Excerpt: remaining content omitted]" : "")
    );
  } finally {
    await file.close();
  }
}
export async function workflowContext(root: string): Promise<unknown> {
  const readme = await excerpt(root, "README.md");
  const source = await excerpt(root, "package.json");
  let scripts: unknown = null;
  if (source) {
    try {
      const value: unknown = JSON.parse(source);
      if (value && typeof value === "object" && "scripts" in value) scripts = value.scripts;
    } catch {
      scripts = "Package scripts unavailable: manifest exceeds context limit or is invalid";
    }
  }
  return { readme, scripts };
}
