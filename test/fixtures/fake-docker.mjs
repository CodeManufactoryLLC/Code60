import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const command = args[0];
appendFileSync(process.env.DOCKER_TEST_LOG, `${JSON.stringify(args)}\n`);
if (command === "info") console.log(process.env.DOCKER_TEST_PLATFORM || "linux/aarch64");
const imageState = `${process.env.DOCKER_TEST_LOG}.image`;
if (command === "build" && !process.env.DOCKER_TEST_NO_IMAGE) {
  writeFileSync(args[args.indexOf("--iidfile") + 1], `sha256:${"a".repeat(64)}\n`);
  writeFileSync(imageState, args[args.indexOf("--tag") + 1]);
}
if (command === "image" && args[1] === "ls" && existsSync(imageState))
  console.log(`sha256:${"a".repeat(64)}`);
if (
  command === "image" &&
  args[1] === "rm" &&
  process.env.DOCKER_TEST_FAIL !== "image rm" &&
  !process.env.DOCKER_TEST_IMAGE_REMOVE_FAIL
) {
  if (readFileSync(imageState, "utf8") !== args.at(-1)) throw new Error("Wrong image removed");
  unlinkSync(imageState);
}
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
const action = command === "image" ? args.slice(0, 2).join(" ") : command;
if (process.env.DOCKER_TEST_HANG === action) {
  // Exercise the host runner's escalation when a Docker client ignores SIGTERM.
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1_000);
} else if (
  process.env.DOCKER_TEST_FAIL === action ||
  (action === "image rm" && process.env.DOCKER_TEST_IMAGE_REMOVE_FAIL)
) {
  process.exitCode = 42;
} else if (process.env.DOCKER_TEST_DELAY === command) {
  setTimeout(() => {}, 500);
}
