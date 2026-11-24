import assert from "node:assert/strict";

// Audit only the fixed supervisor commands exercised by each installed journey.
export function assertSupervisorCalls(calls, { setup, uninstall }) {
  const allowed = ["code60-backend.service", "code60-scheduler.service"].map((unit) => [
    "--user",
    "show",
    unit,
    "--property=LoadState",
    "--property=ActiveState",
    "--property=MainPID",
  ]);
  if (setup)
    allowed.push(
      ["--user", "daemon-reload"],
      ["--user", "enable", "--now", "code60-backend.service"],
      ["--user", "start", "code60-backend.service"],
    );
  if (uninstall)
    allowed.push(
      ["--user", "stop", "code60-backend.service"],
      ["--user", "disable", "--now", "code60-backend.service"],
    );
  const exact = new Set(allowed.map((args) => JSON.stringify(args)));
  assert.ok(
    calls.every((call) => call?.name === "systemctl" && exact.has(JSON.stringify(call.args))),
    "Unexpected supervisor/opener mutation",
  );
}
