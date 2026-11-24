import { createServer, type ServerResponse } from "node:http";

// Fake only the remote model. Transmission, ACP, native Codex and its tools are
// unmodified published executables. This fixture never reads real credentials.
export async function transmissionProvider() {
  let sequence = 0;
  let mode: "hold" | "complete" | "question" = "hold";
  const waiting = new Map<ServerResponse, string>();
  const calls: { method: string; path: string; tool: boolean }[] = [];
  function respond(res: ServerResponse, body: string) {
    const parsed = JSON.parse(body) as { tools?: { name: string }[]; input?: { type: string }[] };
    const verifier = body.includes("Independently verify the candidate");
    const tool =
      mode !== "question" &&
      parsed.tools?.some((item) => item.name === "exec_command") &&
      !parsed.input?.some((item) => item.type === "function_call_output");
    const text = JSON.stringify(
      mode === "question" && !verifier
        ? { kind: "question", question: "Should the fixture preserve the public API?" }
        : verifier
          ? { kind: "verdict", decision: "accept", reason: "Read the isolated workflow result" }
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
            cmd: verifier
              ? "/bin/cat workflow-result.txt"
              : "/usr/bin/printf '%s\\n' 'isolated native workflow' > workflow-result.txt",
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
      features: { shell_snapshot: false },
    }),
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
