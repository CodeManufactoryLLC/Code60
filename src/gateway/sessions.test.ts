import { describe, expect, it } from "vitest";
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
