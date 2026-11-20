import { type BrowserMode, parseBrowserRequest } from "../bridge/index.js";
import { type BrowserClient, startBrowserClient } from "./browser-client.js";

/** One live chat's browser. Never shared with another conversation or workers. */
export class BrowserAutomation {
  private mode: BrowserMode = "headless";
  private client: BrowserClient | undefined;
  private pending: Promise<unknown> | undefined;
  private abort: AbortController | undefined;
  private closed = false;
  private stopping: Promise<void> | undefined;
  constructor(
    private readonly directory: string,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly connect = startBrowserClient,
  ) {}

  call(value: unknown): Promise<unknown> {
    const request = parseBrowserRequest(value);
    if (this.closed) return Promise.reject(new Error("This browser session has ended."));
    if (this.stopping) return Promise.reject(new Error("The browser connection is closing."));
    if (this.pending)
      return Promise.reject(new Error("Wait for the current browser action to finish."));
    const abort = new AbortController();
    this.abort = abort;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(100_000)]);
    const pending = (async () => {
      if (request.action === "status")
        return { mode: this.mode, connected: this.client !== undefined };
      if (request.action === "close" || request.action === "set-mode") {
        if (request.action === "close" || request.mode !== this.mode) {
          await this.client?.close();
          this.client = undefined;
        }
        if (request.action === "set-mode") this.mode = request.mode;
        return { mode: this.mode, connected: this.client !== undefined };
      }
      try {
        this.client ??= await this.connect(this.mode, this.directory, this.env, signal);
        signal.throwIfAborted();
        const tools = await this.client.listTools(signal);
        if (request.action === "list-tools") return { mode: this.mode, tools };
        if (!tools.some((tool) => tool.name === request.name))
          throw new Error("Unknown Playwright tool; discover its name with list-tools.");
        const result = await this.client.call(request.name, request.arguments, signal);
        return { mode: this.mode, result };
      } catch (error) {
        await this.client?.close();
        this.client = undefined;
        throw error;
      }
    })().finally(() => {
      this.pending = undefined;
      this.abort = undefined;
    });
    this.pending = pending;
    return pending;
  }

  cancel(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.abort?.abort();
    this.stopping = (async () => {
      await this.pending?.catch(() => {});
      await this.client?.close();
      this.client = undefined;
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  shutdown(): Promise<void> {
    this.closed = true;
    return this.cancel();
  }
}
