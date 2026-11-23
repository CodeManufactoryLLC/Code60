import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoreDeps } from "../core/index.js";
import { privateDirectory } from "../platform/index.js";

/** Opens a real ACP session without prompting, then stops its process group. */
export async function testAgentConnection(
  agents: CoreDeps["agents"],
  spec: Parameters<CoreDeps["agents"]["start"]>[0],
  signal: AbortSignal,
  timeoutMs = 15_000,
): Promise<void> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  try {
    const session = await agents.start(spec, combined);
    try {
      combined.throwIfAborted();
      session.onPermission(async () => "allow");
    } finally {
      await session.stop(1_000);
    }
    combined.throwIfAborted();
  } catch (error) {
    if (signal.aborted) throw new Error("Connection test cancelled");
    if (timeout.aborted) throw new Error("ACP connection timed out");
    throw error;
  }
}

/** A probe never needs or writes into a project database. Cleanup follows process stop. */
export async function probeAgent(
  agents: CoreDeps["agents"],
  spec: Omit<Parameters<CoreDeps["agents"]["start"]>[0], "cwd">,
  signal: AbortSignal,
  timeoutMs = 15_000,
): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "code60-agent-probe-"));
  const directory = join(temporary, "session");
  try {
    await privateDirectory(directory);
    signal.throwIfAborted();
    await testAgentConnection(agents, { ...spec, cwd: directory }, signal, timeoutMs);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
