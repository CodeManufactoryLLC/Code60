import { expect, it } from "vitest";
import { assertSupervisorCalls } from "./clean-install/supervisor-calls.mjs";

const call = (args, name = "systemctl") => ({ name, args });
const status = call([
  "--user",
  "show",
  "code60-backend.service",
  "--property=LoadState",
  "--property=ActiveState",
  "--property=MainPID",
]);
const setup = [
  call(["--user", "daemon-reload"]),
  call(["--user", "enable", "--now", "code60-backend.service"]),
  call(["--user", "start", "code60-backend.service"]),
];
const removal = [
  call(["--user", "stop", "code60-backend.service"]),
  call(["--user", "disable", "--now", "code60-backend.service"]),
];
it("accepts guarded uninstall's explicit stop before disable and fresh reinstallation", () => {
  expect(() =>
    assertSupervisorCalls([status, ...setup, status, ...removal, ...setup, status], {
      setup: true,
      uninstall: true,
    }),
  ).not.toThrow();
  expect(() => assertSupervisorCalls([status], { setup: false, uninstall: false })).not.toThrow();
  expect(() =>
    assertSupervisorCalls([status, ...setup], { setup: true, uninstall: false }),
  ).not.toThrow();
  for (const command of removal)
    expect(() => assertSupervisorCalls([command], { setup: true, uninstall: false })).toThrow(
      "Unexpected supervisor/opener mutation",
    );
  for (const command of setup)
    expect(() => assertSupervisorCalls([command], { setup: false, uninstall: false })).toThrow(
      "Unexpected supervisor/opener mutation",
    );
});
it("rejects different units, extra arguments, other commands and malformed recorded calls", () => {
  for (const value of [
    call(["--user", "stop", "other.service"]),
    call(["--user", "stop", "code60-backend.service", "extra"]),
    call(["--user", "disable", "code60-backend.service"]),
    call(["--user", "enable", "--now", "other.service"]),
    call(["--user", "show", "other.service", "--property=MainPID"]),
    call(["--user", "daemon-reload", "extra"]),
    call(status.args, "xdg-open"),
    null,
    {},
    call("--user stop code60-backend.service"),
  ])
    expect(() => assertSupervisorCalls([value], { setup: true, uninstall: true })).toThrow(
      "Unexpected supervisor/opener mutation",
    );
});
