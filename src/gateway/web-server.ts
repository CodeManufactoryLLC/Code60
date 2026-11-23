import type { Server } from "node:http";
import type { WebServerStatus } from "../bridge/index.js";
import { isPrivateIPv4, primaryPrivateIPv4 } from "../platform/index.js";

/** Node-only control of an owned host forward; never an application/browser capability. */
export interface LanPublisher {
  address(): Promise<string | null>;
  publish(targetPort: number): Promise<string>;
  withdraw(): Promise<void>;
  onLost(listener: () => void): () => void;
  close(): Promise<void>;
}
export interface WebServerOptions {
  port: number;
  server(origin: () => string): Server;
  save(enabled: boolean): Promise<void>;
  revoke(): Promise<void>;
  publisher?: LanPublisher;
  unsupported?: boolean;
  address?: () => Promise<string | null>;
  intervalMs?: number;
}
const unavailable =
  "LAN access is unavailable. Check the network and whether this port is already in use, then retry.";
export class WebServerBeta {
  private enabled = false;
  private state: WebServerStatus["state"] = "disabled";
  private error: string | null = null;
  private origin = "";
  private server: Server | undefined;
  private published = false;
  private pending: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastAddress: string | null = null;
  private disposeLost: (() => void) | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(private readonly options: WebServerOptions) {
    this.disposeLost = options.publisher?.onLost(() => {
      void this.serial(async () => {
        await this.deactivate().catch(() => {});
        if (this.enabled) {
          this.state = "unavailable";
          this.error = unavailable;
        }
      });
    });
  }
  status(canManage = false): WebServerStatus {
    return {
      enabled: this.enabled,
      state: this.state,
      url: this.state === "listening" ? this.origin : null,
      error: this.error,
      canManage,
    };
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const task = this.pending.then(action);
    this.pending = task.catch(() => {});
    return task;
  }
  async start(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) await this.serial(() => this.activate()).catch(() => {});
    this.timer = setInterval(() => {
      void this.checkNetwork().catch(() => {});
    }, this.options.intervalMs ?? 10_000);
    this.timer.unref();
  }
  private address() {
    if (this.options.unsupported)
      throw new Error("Use npm run devcontainer -- start to enable LAN access for this container.");
    return (
      this.options.publisher?.address.bind(this.options.publisher) ??
      this.options.address ??
      primaryPrivateIPv4
    )();
  }
  private async activate() {
    if (this.closed) throw new Error("Backend is stopping.");
    this.state = "starting";
    this.error = null;
    try {
      const address = await this.address();
      this.lastAddress = address;
      if (!address || !isPrivateIPv4(address)) throw new Error(unavailable);
      const next = `http://${address}:${this.options.port}`;
      this.origin = next;
      const server = this.options.server(() => this.origin);
      this.server = server;
      server.maxConnections = 64;
      server.requestTimeout = 30_000;
      server.headersTimeout = 10_000;
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(
          this.options.publisher ? 0 : this.options.port,
          this.options.publisher ? "127.0.0.1" : address,
          resolve,
        );
      });
      if (this.options.publisher) {
        const target = server.address();
        if (!target || typeof target === "string") throw new Error(unavailable);
        const publishedAddress = await this.options.publisher.publish(target.port);
        this.published = true;
        if (publishedAddress !== address) throw new Error(unavailable);
      }
      this.state = "listening";
    } catch {
      await this.deactivate().catch(() => {});
      this.state = "unavailable";
      this.error = this.options.unsupported
        ? "Use npm run devcontainer -- start to enable LAN access for this container."
        : unavailable;
      throw new Error(this.error);
    }
  }
  private async deactivate() {
    this.state = "stopping";
    await this.options.revoke();
    const errors: unknown[] = [];
    if (this.options.publisher) {
      try {
        await this.options.publisher.withdraw();
        this.published = false;
      } catch (error) {
        errors.push(error);
      }
    }
    if (this.server) {
      const server = this.server;
      try {
        await new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
        this.server = undefined;
      } catch (error) {
        errors.push(error);
      }
    }
    this.origin = "";
    if (errors.length || this.published) {
      this.state = "unavailable";
      this.error = "LAN listener cleanup could not be confirmed. Retry disabling Web Server Beta.";
      throw new Error(this.error);
    }
    this.state = "disabled";
  }
  set(enabled: boolean): Promise<void> {
    return this.serial(async () => {
      if (this.closed) throw new Error("Backend is stopping.");
      if (!enabled) {
        try {
          await this.options.save(false);
        } catch {
          this.error = "Could not save the LAN preference. Retry.";
          throw new Error(this.error);
        }
        this.enabled = false;
        await this.deactivate();
        this.error = null;
        return;
      }
      if (this.enabled && this.state === "listening") return;
      await this.deactivate();
      try {
        await this.activate();
        await this.options.save(true);
        this.enabled = true;
      } catch {
        await this.deactivate().catch(() => {});
        this.state = "unavailable";
        this.error ??= unavailable;
        throw new Error(this.error);
      }
    });
  }
  checkNetwork(): Promise<void> {
    return this.serial(async () => {
      if (this.closed || !this.enabled) return;
      let address: string | null;
      try {
        address = await this.address();
      } catch {
        await this.deactivate().catch(() => {});
        this.state = "unavailable";
        this.error = unavailable;
        return;
      }
      if (address === this.lastAddress) return;
      await this.deactivate();
      this.lastAddress = address;
      await this.activate();
    });
  }
  close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    this.disposeLost?.();
    this.closing ??= this.serial(() => this.deactivate())
      .then(() => this.options.publisher?.close())
      .catch((error) => {
        this.closing = undefined;
        throw error;
      });
    return this.closing;
  }
}
