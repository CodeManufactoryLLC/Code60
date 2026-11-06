import type { CoreDeps } from "../core/index.js";

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
