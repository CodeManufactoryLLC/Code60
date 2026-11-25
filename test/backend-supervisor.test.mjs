import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { backendSupervisor } from "./fixtures/backend-supervisor.mjs";

it("allows only explicit owned uninstall fixture commands and preserves default refusal", async () => {
  for (const allowUninstall of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), "code60-supervisor-test-"));
    const supervisor = await backendSupervisor({
      directory: root,
      application: join(root, "application"),
      env: { HOME: root, XDG_STATE_HOME: join(root, "state") },
      log: join(root, "backend.log"),
      allowUninstall,
    });
    const command = (args) =>
      new Promise((resolve, reject) => {
        const req = request({ socketPath: supervisor.socket, method: "POST" }, (res) => {
          let text = "";
          res.on("data", (part) => {
            text += part;
          });
          res.on("end", () => resolve(JSON.parse(text)));
        });
        req.on("error", reject);
        req.end(JSON.stringify({ name: "systemctl", args }));
      });
    try {
      expect((await command(["--user", "disable", "--now", "code60-backend.service"])).ok).toBe(
        allowUninstall,
      );
      for (const args of [
        ["--user", "disable", "--now", "other.service"],
        ["--user", "disable", "code60-backend.service"],
        ["--user", "disable", "--now", "code60-backend.service", "extra"],
      ])
        expect((await command(args)).ok).toBe(false);
      expect(supervisor.pid()).toBe(null);
    } finally {
      await supervisor.close();
      await rm(root, { recursive: true });
    }
  }
});
