import { describe, expect, it, vi } from "vitest";
import { pairingRequestSchema } from "../bridge/index.js";
import { Sessions } from "./sessions.js";

describe("browser session authority", () => {
  it("consumes pairing once, requires explicit takeover and invalidates the previous generation", () => {
    const sessions = new Sessions();
    const code = sessions.proof();
    const first = sessions.pair(code);
    expect(() => sessions.pair(code)).toThrow("invalid or expired");
    const second = sessions.pair(sessions.proof());
    expect(first.controlling).toBe(true);
    expect(second.controlling).toBe(false);
    expect(() => sessions.assertController(second.token, second.generation)).toThrow(
      "does not control",
    );
    const next = sessions.takeControl(second.token);
    expect(next.previous).toBe(first.token);
    expect(() => sessions.assertController(first.token, first.generation)).toThrow(
      "does not control",
    );
    sessions.assertController(second.token, next.session.generation);
  });
  it("expires proofs and sessions without restoring authority", () => {
    let time = 0;
    const sessions = new Sessions(() => time);
    const proof = sessions.proof();
    time += 60_001;
    expect(() => sessions.pair(proof)).toThrow();
    const session = sessions.pair(sessions.proof());
    time += 12 * 60 * 60_000;
    expect(() => sessions.authenticate(session.token)).toThrow("Pair this browser");
    expect(sessions.pair(sessions.proof()).generation).toBeGreaterThan(session.generation);
  });
  it("resets all proofs and sessions when the local connection policy changes", () => {
    const sessions = new Sessions();
    const first = sessions.connect();
    const proof = sessions.proof();
    sessions.reset();
    expect(() => sessions.authenticate(first.token)).toThrow();
    expect(() => sessions.pair(proof)).toThrow();
    const next = sessions.connect();
    expect(next.controlling).toBe(true);
    expect(next.generation).toBeGreaterThan(first.generation);
  });
});
it("binds LAN proofs and tokens to their exact activation/origin and leaves local sessions intact", () => {
  const sessions = new Sessions();
  const local = sessions.connect();
  const scope = "lan:1:http://192.168.0.16:43160";
  const code = sessions.proof(scope);
  expect(() => sessions.pair(code)).toThrow();
  const remote = sessions.pair(code, scope);
  expect(remote.controlling).toBe(false);
  expect(() => sessions.authenticate(local.token, scope)).toThrow();
  expect(() => sessions.authenticate(remote.token)).toThrow();
  expect(() => sessions.authenticate(remote.token, "lan:2:http://192.168.0.16:43160")).toThrow();
  const pending = sessions.proof(scope);
  sessions.clearProofs("lan:");
  expect(() => sessions.pair(pending, scope)).toThrow();
  expect(sessions.tokens("lan:")).toEqual([remote.token]);
  sessions.revoke("lan:");
  expect(() => sessions.authenticate(remote.token, scope)).toThrow();
  expect(sessions.authenticate(local.token)).toBe(local.token);
});
it("issues grouped six-digit LAN codes with leading zeroes and accepts either entry format once", () => {
  let time = 0;
  const scope = "lan:1:http://192.168.0.16:43160";
  const sessions = new Sessions(
    () => time,
    () => 7,
  );
  expect(sessions.proof()).toMatch(/^[a-f0-9]{16}$/);
  const code = sessions.proof(scope);
  expect(code).toBe("000-007");
  for (const value of [code, "000007", "a".repeat(16)])
    expect(pairingRequestSchema.parse({ code: value, version: 1 }).code).toBe(value);
  for (const value of ["12345", "1234567", "12-3456", "123-45x", "123--456"])
    expect(pairingRequestSchema.safeParse({ code: value, version: 1 }).success).toBe(false);
  expect(() => sessions.pair("000007")).toThrow("invalid or expired");
  const remote = sessions.pair("000007", scope);
  expect(sessions.authenticate(remote.token, scope)).toBe(remote.token);
  expect(() => sessions.pair(code, scope)).toThrow("invalid or expired");
  const expiring = new Sessions(
    () => time,
    () => 123456,
  );
  expect(expiring.proof(scope)).toBe("123-456");
  time = 60_000;
  expect(() => expiring.pair("123-456", scope)).toThrow("invalid or expired");
});
it("avoids active-code collisions and never immediately repeats a rotated LAN code", () => {
  const values = [0, 7, 0, 7, 999999, 999999, 123456];
  const random = vi.fn(() => values.shift() ?? 0);
  const sessions = new Sessions(Date.now, random);
  const scope = "lan:1:http://192.168.0.16:43160";
  expect(sessions.proof(scope)).toBe("000-000");
  expect(sessions.proof(scope)).toBe("000-007");
  expect(sessions.proof(scope)).toBe("999-999");
  sessions.clearProofs("lan:");
  expect(sessions.proof(scope)).toBe("123-456");
  expect(() => sessions.pair("999-999", scope)).toThrow("invalid or expired");
  expect(random).toHaveBeenCalledTimes(7);
  expect(random).toHaveBeenCalledWith(1_000_000);
});
it("bounds code generation when the entropy source repeatedly collides", () => {
  const random = vi.fn(() => 0);
  const sessions = new Sessions(Date.now, random);
  sessions.proof("lan:1");
  sessions.clearProofs("lan:");
  expect(() => sessions.proof("lan:1")).toThrow("Could not create a pairing code");
  expect(random).toHaveBeenCalledTimes(33);
});
