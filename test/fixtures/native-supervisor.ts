import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Fake only the native systemd boundary; the app launches its real scheduler. */
export async function nativeSupervisorFixture(directory: string) {
  const bin = join(directory, "supervisor-bin");
  await mkdir(bin);
  await copyFile(join(import.meta.dirname, "native-supervisor.mjs"), join(bin, "systemctl"));
  await chmod(join(bin, "systemctl"), 0o700);
  return {
    environment: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      CODE60_TEST_SUPERVISOR_ROOT: directory,
      CODE60_TEST_SERVICE_ENTRY: resolve(import.meta.dirname, "../../dist/automation/main.js"),
    },
    async cleanup() {
      const pid = Number(
        await readFile(join(directory, "supervisor-pid"), "utf8").catch(() => "0"),
      );
      if (pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        const alive = () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
            return false;
          }
        };
        const deadline = Date.now() + 3000;
        while (alive() && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 25));
        if (alive()) {
          process.kill(pid, "SIGKILL");
          const killedDeadline = Date.now() + 2000;
          while (alive() && Date.now() < killedDeadline)
            await new Promise((resolve) => setTimeout(resolve, 25));
          if (alive()) throw new Error("Owned test scheduler did not exit");
        }
      }
    },
  };
}
