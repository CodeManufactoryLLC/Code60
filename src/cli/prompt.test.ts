import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readPrompt } from "./prompt.js";

const stdin = (text: string, isTTY = false) =>
  Object.assign(Readable.from([Buffer.from(text)]), { isTTY });
const noFile = async () => {
  throw Object.assign(new Error("nope"), { code: "ENOENT" });
};

describe("readPrompt", () => {
  it("reads the argument, a file, or piped standard input", async () => {
    expect(await readPrompt({ arg: "fix it", readFile: noFile })).toBe("fix it");
    expect(await readPrompt({ file: "p.txt", readFile: async () => "from file" })).toBe(
      "from file",
    );
    expect(await readPrompt({ stdin: stdin("from stdin"), readFile: noFile })).toBe("from stdin");
  });

  it("returns undefined for a missing prompt when it is optional", async () => {
    expect(await readPrompt({ stdin: stdin("", true), readFile: noFile, optional: true })).toBe(
      undefined,
    );
    expect(await readPrompt({ arg: "x", readFile: noFile, optional: true })).toBe("x");
  });

  it("prefers the argument over a piped standard input", async () => {
    expect(await readPrompt({ arg: "arg", stdin: stdin("ignored"), readFile: noFile })).toBe("arg");
  });

  it("rejects conflicting, missing, and empty prompts without echoing them", async () => {
    await expect(readPrompt({ arg: "secret", file: "p", readFile: noFile })).rejects.toThrow(
      /not both/,
    );
    await expect(readPrompt({ stdin: stdin("", true), readFile: noFile })).rejects.toThrow(
      /missing prompt/,
    );
    await expect(readPrompt({ readFile: noFile })).rejects.toThrow(/missing prompt/);
    await expect(readPrompt({ arg: "  \n", readFile: noFile })).rejects.toThrow(/empty/);
    const error = await readPrompt({ file: "missing.txt", readFile: noFile }).catch(
      (e: Error) => e,
    );
    expect((error as Error).message).toBe("cannot read the prompt file 'missing.txt' (ENOENT)");
    expect((error as Error).name).toBe("UsageError");
  });
});
