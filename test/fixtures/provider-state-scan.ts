import assert from "node:assert/strict";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

const runTemporary =
  /(?:^|\/)[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/;

export async function assertProviderStateSecretFree(
  root: string,
  options: { live?: boolean; beforeOpen?(entry: string): Promise<void> } = {},
) {
  for (const entry of await readdir(root, { recursive: true })) {
    await options.beforeOpen?.(entry);
    const file = await open(join(root, entry), "r").catch((error: NodeJS.ErrnoException) => {
      // Live atomic writers can rename their UUID sibling or release a diagnostic lock.
      // The journey repeats this scan strictly after all backend writers have stopped.
      if (
        options.live &&
        error.code === "ENOENT" &&
        (entry.endsWith("/.lock") || runTemporary.test(entry))
      )
        return null;
      throw error;
    });
    if (!file) continue;
    try {
      if ((await file.stat()).isFile())
        assert.doesNotMatch(await file.readFile("utf8"), /QA60-1234|QA60-PASTE|PRIVATE-STATE/);
    } finally {
      await file.close();
    }
  }
}
