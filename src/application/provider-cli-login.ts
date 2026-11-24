import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";
import type { ProviderLoginChallenge, SetupProviderId } from "../bridge/index.js";
import { type OwnedProcess, spawnOwnedProcess } from "../platform/index.js";
import {
  type ProviderLoginContext,
  ProviderSetupError,
  validateLoginChallenge,
} from "./provider-setup-policy.js";

export type ProviderSpawn = typeof spawnOwnedProcess;
const args = (provider: SetupProviderId, method: ProviderLoginContext["method"]): string[] => {
  switch (provider) {
    case "claude":
      return ["auth", "login", method === "claude-console" ? "--console" : "--claudeai"];
    case "antigravity":
      return ["acp", "--login", "--log-file", "/dev/null", "--disable-telemetry"];
    case "copilot":
      return ["login", "--device-code", "--host", "github.com"];
    case "kiro":
      return ["login", "--use-device-flow"];
    default:
      throw new ProviderSetupError("unsupported");
  }
};

/** Pinned CLI login-only protocols. No output is forwarded to snapshots, logs or a terminal. */
export async function loginProviderCli(
  provider: SetupProviderId,
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  context: ProviderLoginContext,
  spawn: ProviderSpawn = spawnOwnedProcess,
): Promise<void> {
  let child: OwnedProcess;
  try {
    child = await spawn([executable, ...args(provider, context.method)], cwd, {
      ...env,
      NO_BROWSER: "1",
      BROWSER: "/usr/bin/true",
      CI: "1",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      LC_ALL: "C",
      LANG: "C",
      DISABLE_AUTOUPDATER: "1",
    });
  } catch {
    throw new ProviderSetupError("missing");
  }
  let total = 0;
  let buffer = "";
  let seen = false;
  let entered = false;
  let confirmed = false;
  let waiting = false;
  let failure: Error | undefined;
  let rejectFailure: (error: Error) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  const fail = (error = new ProviderSetupError("login")) => {
    if (!failure) {
      failure = error;
      rejectFailure(error);
    }
  };
  const provide = (challenge: ProviderLoginChallenge, confirmation = false) => {
    waiting = true;
    void context.input(validateLoginChallenge(provider, challenge)).then(
      (answer) => {
        if (context.signal.aborted || failure) return;
        if (confirmation) {
          if (answer.kind !== "confirmation" || !answer.accepted) {
            fail();
            return;
          }
          confirmed = true;
          child.stdin.write("y\n");
        } else {
          if (answer.kind !== "code") {
            fail();
            return;
          }
          entered = true;
          child.stdin.write(`${answer.code}\n`);
        }
        waiting = false;
        buffer = "";
      },
      () => fail(),
    );
  };
  const decoders = [new StringDecoder("utf8"), new StringDecoder("utf8")];
  const receive = (data: Buffer, stream: number) => {
    if (failure || context.signal.aborted) return;
    try {
      total += data.length;
      if (total > 1024 * 1024) throw new ProviderSetupError("login");
      buffer += decoders[stream]?.write(data) ?? "";
      if (Buffer.byteLength(buffer) > 64 * 1024) throw new ProviderSetupError("login");
      // Strip control sequences before recognizing the fixed prompts. Never render them.
      const plain = stripVTControlCharacters(buffer);
      if (waiting) return;
      if (
        provider === "copilot" &&
        !confirmed &&
        /(?:store|save)[^\n]*(?:plain.?text|unencrypted)|(?:plain.?text|unencrypted)[^\n]*(?:store|save)/i.test(
          plain,
        )
      ) {
        provide(
          { kind: "confirmation", challengeId: randomUUID(), confirmation: "save-copilot-login" },
          true,
        );
        return;
      }
      if (
        plain
          .split("\n")
          .some(
            (line) =>
              !line.includes("https://") &&
              /(?:\[y\/n\]|\(y\/n\)|\?\s*$)/i.test(line) &&
              !/paste.*(?:code|authorization)/i.test(line),
          )
      )
        throw new ProviderSetupError("unsupported");
      const urls = [...plain.matchAll(/https:\/\/[^\s<>"]+(?=\s|[<>"])/g)].map((match) =>
        match[0].replace(/[),.]$/, ""),
      );
      const url = urls.at(-1);
      if (!url) return;
      if (provider === "claude" || provider === "antigravity") {
        if (entered) return;
        const challenge = validateLoginChallenge(provider, {
          kind: "code",
          challengeId: randomUUID(),
          verificationUrl: url,
        });
        seen = true;
        provide(challenge);
      } else if (!seen) {
        const code = /(?:code\s*(?:is|:|=)?\s*)([A-Z0-9]{4}(?:-[A-Z0-9]{4})?)(?=[\s.,]|$)/i.exec(
          plain,
        )?.[1];
        if (!code) return;
        const challenge = validateLoginChallenge(provider, {
          kind: "device",
          challengeId: randomUUID(),
          verificationUrl: url,
          userCode: code,
        });
        seen = true;
        context.challenge(challenge);
      }
    } catch (error) {
      fail(error instanceof ProviderSetupError ? error : new ProviderSetupError("login"));
    }
  };
  const stdout = (data: Buffer) => receive(data, 0);
  const stderr = (data: Buffer) => receive(data, 1);
  const abort = () => fail(new ProviderSetupError("timeout"));
  child.stdout.on("data", stdout);
  child.stderr.on("data", stderr);
  context.signal.addEventListener("abort", abort, { once: true });
  let outcome: unknown;
  try {
    if (context.signal.aborted) abort();
    const exit = await Promise.race([child.exited, failed]);
    if (failure) throw failure;
    if (
      exit.code !== 0 ||
      !seen ||
      waiting ||
      ((provider === "claude" || provider === "antigravity") && !entered)
    )
      throw new ProviderSetupError("login");
  } catch (error) {
    outcome = error;
  } finally {
    child.stdout.off("data", stdout);
    child.stderr.off("data", stderr);
    context.signal.removeEventListener("abort", abort);
    context.challenge(null);
    try {
      await child.stop(1_000);
    } catch {
      outcome = new ProviderSetupError("cleanup");
    }
  }
  if (outcome) throw outcome;
}
