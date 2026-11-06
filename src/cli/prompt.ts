import { UsageError } from "../core/index.js";

export interface PromptSources {
  arg?: string;
  file?: string;
  stdin?: (AsyncIterable<Buffer | string> & { isTTY?: boolean }) | undefined;
  readFile(path: string): Promise<string>;
  /** Return undefined instead of failing when no source gives a prompt. */
  optional?: boolean;
}

/**
 * Reads the first prompt from exactly one source: the argument, `--prompt-file`, or standard
 * input when it is not a TTY. Errors never include the prompt's contents.
 */
export async function readPrompt(
  sources: PromptSources & { optional: true },
): Promise<string | undefined>;
export async function readPrompt(sources: PromptSources): Promise<string>;
export async function readPrompt({
  arg,
  file,
  stdin,
  readFile,
  optional = false,
}: PromptSources): Promise<string | undefined> {
  if (arg !== undefined && file !== undefined) {
    throw new UsageError("give the prompt as an argument or with --prompt-file, not both");
  }
  let text: string;
  if (arg !== undefined) {
    text = arg;
  } else if (file !== undefined) {
    try {
      text = await readFile(file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "unreadable";
      throw new UsageError(`cannot read the prompt file '${file}' (${code})`);
    }
  } else if (stdin !== undefined && stdin.isTTY !== true) {
    const chunks: string[] = [];
    for await (const chunk of stdin) chunks.push(chunk.toString());
    text = chunks.join("");
  } else if (optional) {
    return undefined;
  } else {
    throw new UsageError(
      "missing prompt: pass it as an argument, with --prompt-file, or on standard input",
    );
  }
  if (text.trim() === "") throw new UsageError("the prompt is empty");
  return text;
}
