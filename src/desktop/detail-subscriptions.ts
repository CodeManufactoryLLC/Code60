import type { DetailFrame, DetailPayload, DetailRequest } from "../bridge/index.js";
import { detailScopeKey } from "../bridge/index.js";

interface Subscription {
  request: DetailRequest;
  previousRevision: number;
  valid(): void;
  read(allEvents: boolean): DetailPayload;
  emit(frame: DetailFrame): void;
  version?(): unknown;
  publishedVersion?: unknown;
}

/** Read-only presentation ownership, never worker authority or a lifecycle queue. */
export class DetailSubscriptions {
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(private readonly released: (id: string) => void = () => {}) {}

  capture(id: string): { scope: DetailRequest["scope"]; valid(): void } {
    const entry = this.subscriptions.get(id);
    if (!entry) throw new Error("This detail subscription is no longer available");
    const valid = () => {
      if (this.subscriptions.get(id) !== entry)
        throw new Error("This detail subscription is no longer available");
      entry.valid();
    };
    valid();
    return { scope: structuredClone(entry.request.scope), valid };
  }

  subscribe(
    request: DetailRequest,
    revision: number,
    source: Pick<Subscription, "valid" | "read" | "emit" | "version">,
  ): void {
    source.valid();
    const previous = this.subscriptions.get(request.subscriptionId);
    if (previous) {
      if (detailScopeKey(previous.request.scope) !== detailScopeKey(request.scope))
        throw new Error("This detail subscription already addresses another owner");
      previous.valid();
      return;
    }
    if (this.subscriptions.size >= 128)
      throw new Error("Too many detail subscriptions. Close an unused view and retry.");
    this.subscriptions.set(request.subscriptionId, {
      ...source,
      request: structuredClone(request),
      previousRevision: revision,
      publishedVersion: source.version?.(),
    });
  }

  read(request: DetailRequest, revision: number): DetailFrame {
    const entry = this.subscriptions.get(request.subscriptionId);
    if (!entry || detailScopeKey(entry.request.scope) !== detailScopeKey(request.scope))
      throw new Error("This detail subscription is no longer available");
    entry.valid();
    const payload = entry.read(true);
    entry.valid();
    return { ...entry.request, revision, previousRevision: null, closed: false, payload };
  }

  publish(revision: number): void {
    for (const [id, entry] of this.subscriptions) {
      if (revision <= entry.previousRevision) continue;
      const address = { ...entry.request, revision, previousRevision: entry.previousRevision };
      let frame: DetailFrame;
      try {
        entry.valid();
        const version = entry.version?.();
        if (entry.version && Object.is(version, entry.publishedVersion)) continue;
        const payload = entry.read(false);
        entry.valid();
        frame = { ...address, closed: false, payload };
        entry.publishedVersion = version;
      } catch {
        frame = { ...address, closed: true };
        this.unsubscribe(id);
      }
      entry.previousRevision = revision;
      try {
        entry.emit(frame);
      } catch {
        this.unsubscribe(id);
      }
    }
  }

  unsubscribe(id: string): void {
    if (!this.subscriptions.delete(id)) return;
    try {
      this.released(id);
    } catch {
      // A failed release callback cannot strand other registered owners.
    }
  }

  clear(): void {
    for (const id of this.subscriptions.keys()) this.unsubscribe(id);
  }
  revisions(): Record<string, number> {
    return Object.fromEntries(
      [...this.subscriptions].map(([id, entry]) => [id, entry.previousRevision]),
    );
  }
}
