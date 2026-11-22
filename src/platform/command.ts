import { assertSupportedPlatform } from "./support.js";

export interface ExecutableCommand {
  file: string;
  args: string[];
}

/** Pass argument arrays directly to the executable, without a shell. */
export async function resolveCommand(
  command: readonly [string, ...string[]],
  _env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ExecutableCommand> {
  assertSupportedPlatform(platform);
  const [file, ...args] = command;
  return { file, args };
}
