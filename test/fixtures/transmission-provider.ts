import { createServer, type ServerResponse } from "node:http";
import { basename, dirname } from "node:path";

const readResult = "/bin/cat workflow-result.txt";
const writeResult = "/usr/bin/printf '%s\\n' 'isolated native workflow' > workflow-result.txt";

// Fake only the remote model. Transmission, ACP, native Codex and its tools are
// unmodified published executables. This fixture never reads real credentials.
export async function transmissionProvider(worktrees?: string) {
  let sequence = 0;
  let mode: "hold" | "complete" | "question" = "hold";
  const waiting = new Map<ServerResponse, string>();
  const calls: { method: string; path: string; tool: boolean }[] = [];
  function respond(res: ServerResponse, body: string) {
    const parsed = JSON.parse(body) as {
      tools?: { name: string }[];
      input?: {
        type: string;
        output?: string;
        arguments?: string;
        content?: { text?: string }[];
      }[];
      text?: { format?: { schema?: { required?: string[] } } };
    };
    // Codex sends a separate, structured approval-review request when Docker
    // disallows namespaces. Review only the two fixture actions in its worktree.
    const reviewing = parsed.text?.format?.schema?.required?.includes("outcome");
    let permitted = false;
    if (reviewing && worktrees) {
      const parts = parsed.input?.at(-1)?.content ?? [];
      const marker = parts.findLastIndex((part) => part.text?.trim() === "Planned action JSON:");
      const action = marker >= 0 && JSON.parse(parts[marker + 1]?.text ?? "null");
      permitted = Boolean(
        action &&
          action.tool === "exec_command" &&
          action.environment_id === "local" &&
          dirname(action.cwd) === worktrees &&
          /^transmission-[0-9a-f-]{36}$/.test(basename(action.cwd)) &&
          Array.isArray(action.command) &&
          action.command.length === 3 &&
          action.command[0] === "/bin/bash" &&
          action.command[1] === "-c" &&
          [readResult, writeResult].includes(action.command[2]),
      );
    }
    const verifier = body.includes("Independently verify the candidate");
    const lastOutput = parsed.input?.findLast(
      (item) => item.type === "function_call_output",
    )?.output;
    // A container can deny unprivileged namespaces. Exercise the same bounded
    // harness permission request a real model uses for this fixture command.
    const retryWithApproval =
      lastOutput?.includes("bwrap: No permissions to create a new namespace") &&
      !parsed.input?.some(
        (item) => item.type === "function_call" && item.arguments?.includes("require_escalated"),
      );
    const tool =
      !reviewing &&
      mode !== "question" &&
      parsed.tools?.some((item) => item.name === "exec_command") &&
      (!lastOutput || retryWithApproval);
    const text = JSON.stringify(
      reviewing
        ? { outcome: permitted ? "allow" : "deny" }
        : !tool && lastOutput && !lastOutput.includes("Process exited with code 0")
          ? { kind: "question", question: "The fixture command failed. Inspect its output." }
          : mode === "question" && !verifier
            ? { kind: "question", question: "Should the fixture preserve the public API?" }
            : verifier
              ? {
                  kind: "verdict",
                  decision: lastOutput?.trimEnd().endsWith("\nisolated native workflow")
                    ? "accept"
                    : "reject",
                  reason: "Compared the isolated file contents with the requested text",
                }
              : { kind: "result", summary: "Created the isolated workflow result" },
    );
    const id = ++sequence;
    const message = tool
      ? {
          id: `fc_${id}`,
          type: "function_call",
          call_id: `call_${id}`,
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: verifier ? readResult : writeResult,
            ...(retryWithApproval
              ? {
                  sandbox_permissions: "require_escalated",
                  justification:
                    "Run the approved read or write of workflow-result.txt in the disposable workflow checkout.",
                }
              : {}),
            login: false,
            max_output_tokens: 1000,
          }),
          status: "completed",
        }
      : {
          id: `msg_${id}`,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        };
    const response = {
      id: `resp_${id}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: "code60-fixture",
      status: "completed",
      output: [message],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    };
    const events = [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: tool
          ? { ...message, arguments: "", status: "in_progress" }
          : { ...message, content: [], status: "in_progress" },
      },
      ...(tool
        ? [
            {
              type: "response.function_call_arguments.delta",
              item_id: message.id,
              output_index: 0,
              delta: message.arguments,
            },
            {
              type: "response.function_call_arguments.done",
              item_id: message.id,
              output_index: 0,
              arguments: message.arguments,
            },
          ]
        : [
            {
              type: "response.content_part.added",
              item_id: message.id,
              output_index: 0,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [] },
            },
            {
              type: "response.output_text.delta",
              item_id: message.id,
              output_index: 0,
              content_index: 0,
              delta: text,
            },
          ]),
      { type: "response.output_item.done", output_index: 0, item: message },
      { type: "response.completed", response },
    ];
    calls.push({ method: "POST", path: "/v1/responses", tool: Boolean(tool) });
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const [index, event] of events.entries())
      res.write(
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`,
      );
    res.end();
  }
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST" || req.url !== "/v1/responses")
        throw Error("Unexpected fake provider request");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const bytes of req) {
        size += bytes.length;
        if (size > 2 * 1024 ** 2) throw Error("Fake provider request too large");
        chunks.push(bytes);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      JSON.parse(body);
      if (mode === "hold") {
        waiting.set(res, body);
        res.once("close", () => waiting.delete(res));
      } else respond(res, body);
    })().catch(() => res.writeHead(500).end("Fake provider rejected unexpected request"));
  });
  await new Promise<void>((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Fake provider did not bind");
  return {
    calls,
    get pending() {
      return waiting.size;
    },
    config: JSON.stringify({
      model: "code60-fixture",
      model_provider: "code60_fixture",
      model_providers: {
        code60_fixture: {
          name: "Code60 isolated fixture",
          base_url: `http://127.0.0.1:${address.port}/v1`,
          wire_api: "responses",
          requires_openai_auth: false,
        },
      },
      web_search: "disabled",
      // Exercise the pinned engine's tools, without unrelated remote plugin
      // catalog startup/Git acquisition in this isolated model fixture.
      features: { shell_snapshot: false, plugins: false, remote_plugin: false },
    }),
    toml: `model = "code60-fixture"\nmodel_provider = "code60_fixture"\nweb_search = "disabled"\n[features]\nshell_snapshot = false\nplugins = false\nremote_plugin = false\n[model_providers.code60_fixture]\nname = "Code60 isolated fixture"\nbase_url = "http://127.0.0.1:${address.port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`,
    setMode(next: typeof mode) {
      mode = next;
      if (mode === "hold") return;
      for (const [res, body] of waiting) {
        waiting.delete(res);
        respond(res, body);
      }
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((ready, reject) =>
        server.close((error) => (error ? reject(error) : ready())),
      );
    },
  };
}
