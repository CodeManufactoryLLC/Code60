import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { TRANSMISSION_VERSION, type WorkflowRecord } from "../bridge/index.js";
import { privateDirectory, readPrivateJson, spawnOwnedProcess } from "../platform/index.js";

export interface TransmissionClient {
  readonly supported: boolean;
  call(operation: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  connect(signal: AbortSignal): Promise<void>;
}
const endpointSchema = z.strictObject({
  port: z.number().int().min(1).max(65535),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
const operations = new Set([
  "health",
  "start_workflow",
  "get_workflow",
  "get_workflow_events",
  "get_workflow_diff",
  "answer_workflow_question",
  "send_workflow_message",
  "cancel_workflow",
  "pause_workflow",
  "resume_workflow",
]);
export class LocalTransmission implements TransmissionClient {
  readonly supported = process.platform === "darwin";
  constructor(
    private readonly root: string,
    private readonly environment: Readonly<NodeJS.ProcessEnv>,
    private readonly version: NonNullable<WorkflowRecord["engineVersion"]> = TRANSMISSION_VERSION,
  ) {}
  async call(
    operation: string,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!operations.has(operation)) throw new Error("Unknown workflow operation");
    const endpoint = endpointSchema.parse(
      await readPrivateJson(join(this.root, "endpoint.json"), 4096),
    );
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/${operation}`, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.any([
        AbortSignal.timeout(
          operation === "health"
            ? 2_000
            : operation === "cancel_workflow" || operation === "pause_workflow"
              ? 180_000
              : operation === "start_workflow"
                ? 120_000
                : 10_000,
        ),
        ...(signal ? [signal] : []),
      ]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        "Transmission rejected the request. Inspect workflow status before retrying.",
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Transmission returned no data");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 8 * 1024 * 1024) throw new Error("Transmission response exceeded its limit");
        chunks.push(next.value);
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  async connect(signal: AbortSignal): Promise<void> {
    if (!this.supported) throw new Error("Transmission execution requires macOS");
    try {
      await this.call("health", {}, signal);
      return;
    } catch {
      signal.throwIfAborted();
    }
    const environment = { ...this.environment };
    for (const key of Object.keys(environment))
      if (/^npm_config_/i.test(key) || key === "NODE_OPTIONS" || key === "NODE_PATH")
        delete environment[key];
    const { stdout } = await promisify(execFile)(
      "node",
      ["-p", "JSON.stringify({version:process.versions.node,executable:process.execPath})"],
      { env: environment, timeout: 5_000, maxBuffer: 4096, signal },
    );
    const runtime = z
      .strictObject({ version: z.string(), executable: z.string() })
      .parse(JSON.parse(stdout));
    if (!/^24\.(?:2[2-9]|[3-9]\d|\d{3,})\./.test(runtime.version))
      throw new Error("Install Node.js >=24.22.0 <25 with npm to run Transmission");
    await privateDirectory(this.root);
    const cache = join(dirname(this.root), "npm-cache");
    await privateDirectory(cache);
    const temporary = await mkdtemp(join(tmpdir(), "code60-transmission-launch-"));
    const config = join(temporary, ".npmrc");
    const globalConfig = join(temporary, "global.npmrc");
    try {
      await writeFile(config, "", { mode: 0o600 });
      await writeFile(globalConfig, "", { mode: 0o600 });
      await writeFile(
        join(temporary, "package.json"),
        '{"name":"code60-transmission-launch","private":true}',
        { mode: 0o600 },
      );
      Object.assign(environment, {
        PATH: `${dirname(runtime.executable)}:${environment.PATH ?? ""}`,
        TRANSMISSION_STATE_DIR: this.root,
        NPM_CONFIG_USERCONFIG: config,
        NPM_CONFIG_GLOBALCONFIG: globalConfig,
        NPM_CONFIG_CACHE: cache,
        NPM_CONFIG_PREFIX: temporary,
        NPM_CONFIG_GLOBAL: "false",
        NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
        NPM_CONFIG_IGNORE_SCRIPTS: "true",
        NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
      });
      const child = await spawnOwnedProcess(
        ["npx", "-y", `code60-transmission-server@${this.version}`, "mcp"],
        temporary,
        environment,
      );
      child.stdout.resume();
      child.stderr.resume();
      try {
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          signal.throwIfAborted();
          try {
            await this.call("health", {}, signal);
            return;
          } catch {
            signal.throwIfAborted();
          }
          if (child.hasExited())
            throw new Error("Transmission launcher failed. Check Node/npm and Codex setup.");
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(
          "Transmission startup timed out; engine state is unconfirmed. Reconnect before retrying.",
        );
      } finally {
        child.stdin.end();
        await child.stop(1_000);
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
