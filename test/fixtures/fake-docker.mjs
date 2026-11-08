import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const command = args[0];
appendFileSync(process.env.DOCKER_TEST_LOG, `${JSON.stringify(args)}\n`);
if (command === "info") console.log(process.env.DOCKER_TEST_PLATFORM || "linux/aarch64");
if (command === "build")
  writeFileSync(args[args.indexOf("--iidfile") + 1], `sha256:${"a".repeat(64)}\n`);
if (command === "start") {
  const calls = readFileSync(process.env.DOCKER_TEST_LOG, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const create = calls.find((call) => call[0] === "create");
  const mount = create[create.indexOf("--mount") + 1];
  const source = /^type=bind,"source=((?:[^"]|"")*)",target=/.exec(mount)[1];
  writeFileSync(join(source.replaceAll('""', '"'), "failure.txt"), "retained artifact\n");
}
if (process.env.DOCKER_TEST_HANG === command) {
  // Exercise the host runner's escalation when a Docker client ignores SIGTERM.
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1_000);
} else if (process.env.DOCKER_TEST_FAIL === command) {
  process.exitCode = 42;
} else if (process.env.DOCKER_TEST_DELAY === command) {
  setTimeout(() => {}, 500);
}
