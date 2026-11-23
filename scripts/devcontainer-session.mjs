import { spawn } from "node:child_process";

// stdin belongs to the host command, not a terminal. Its EOF requests a graceful
// shutdown before Docker removes the container (docker exec alone cannot do that).
const child = spawn(process.execPath, ["scripts/dev.mjs"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
let deadline;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  deadline = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") process.exitCode = 1;
    }
  }, 35_000);
};
process.stdin.resume();
process.stdin.once("end", stop);
process.stdin.once("error", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.once("error", () => {
  process.stderr.write("Could not launch container development.\n");
  process.exitCode = 1;
});
child.once("close", (code) => {
  clearTimeout(deadline);
  process.stdin.destroy();
  process.exitCode = code ?? 1;
});
