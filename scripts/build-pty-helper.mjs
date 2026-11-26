import { execFileSync } from "node:child_process";
import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "native", "posix", "code60-pty.c");
const output = join(root, "dist", "platform", "code60-pty");

function isFresh(target, input) {
  try {
    accessSync(target, constants.X_OK);
    return statSync(target).mtimeMs >= statSync(input).mtimeMs;
  } catch {
    return false;
  }
}

function findCompiler() {
  for (const candidate of ["cc", "clang", "gcc"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore", timeout: 5_000 });
      return candidate;
    } catch {
      // Try next C compiler.
    }
  }
  throw new Error(
    "A C compiler (cc, clang, or gcc) is required to build the POSIX PTY helper native/posix/code60-pty.c",
  );
}

if (process.platform !== "darwin" && process.platform !== "linux") {
  throw new Error(`Unsupported platform for PTY helper: ${process.platform}`);
}

if (!isFresh(output, source)) {
  mkdirSync(dirname(output), { recursive: true });
  const compiler = findCompiler();
  const flags = ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", source, "-o", output];
  if (process.platform === "linux") flags.push("-lutil");
  execFileSync(compiler, flags, { stdio: "inherit", timeout: 60_000 });
}
