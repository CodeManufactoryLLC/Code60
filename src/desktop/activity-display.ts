import { randomUUID } from "node:crypto";
import {
  ACTIVITY_LIFETIME_MS,
  ACTIVITY_MESSAGE_MS,
  ACTIVITY_TYPES,
  type ActivityAcknowledgment,
  type ActivityDeclaration,
  type ActivitySnapshot,
  type ActivityState,
  isActivityTool,
  parseActivityReport,
} from "../bridge/index.js";
import type { RunEvent, RunView } from "../core/index.js";

type Operation = { state: ActivityState; order: number; pending: boolean; until?: number };
const labels: Partial<Record<ActivityState, string>> = {
  connecting: "Connecting",
  responding: "Responding",
  preparing: "Preparing",
  searching: "Searching",
  reading: "Reading",
  editing: "Editing",
  deleting: "Deleting",
  moving: "Moving",
  executing: "Running command",
  retrieving: "Retrieving",
  dispatching: "Dispatching worker",
  sending: "Sending to worker",
  receiving: "Receiving worker results",
  waiting_for_approval: "Waiting for approval",
  waiting_for_workers: "Waiting for workers",
  working: "Working",
  stopping: "Stopping",
  idle: "Idle",
  finished: "Turn finished",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  interrupted: "Interrupted",
};
const toolStates: Record<string, ActivityState> = {
  search: "searching",
  read: "reading",
  edit: "editing",
  delete: "deleting",
  move: "moving",
  execute: "executing",
  fetch: "retrieving",
};
const terminal = new Set(["finished", "failed", "cancelled", "timed_out", "interrupted"]);

/** Live-only display state. Feed new events, never saved or restored transcript entries. */
export class ActivityDisplay {
  private scope: string | null = null;
  private sequence = 0;
  private lastRequest = "";
  private acknowledgment: ActivityAcknowledgment = { sequence: 0, expiresAt: null };
  private declaration: ActivityDeclaration | null = null;
  private operations = new Map<string, Operation>();
  private ignored = new Set<string>();
  private order = 0;
  private message: { until: number; order: number } | undefined;
  private outcome: ActivityState | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;
  private readonly newScope: () => string;
  constructor(
    private readonly deps: { changed(): void; now?: () => number; newScope?: () => string },
  ) {
    this.now = deps.now ?? Date.now;
    this.newScope = deps.newScope ?? randomUUID;
  }

  context() {
    this.expire();
    return {
      activityTypes: Object.entries(ACTIVITY_TYPES).map(([type, description]) => ({
        type,
        description,
      })),
      scope: this.scope,
      lastSequence: this.sequence,
      declaration: this.declaration ? { ...this.declaration } : null,
    };
  }

  report(value: unknown): ActivityAcknowledgment {
    const request = parseActivityReport(value);
    if (this.scope === null || request.scope !== this.scope)
      throw new Error(
        "Activity scope is stale or no turn is active; call code60_get_activity_context",
      );
    const key = JSON.stringify(request);
    if (request.sequence === this.sequence && key === this.lastRequest)
      return { ...this.acknowledgment };
    if (request.sequence <= this.sequence)
      throw new Error("Activity sequence must increase; conflicting or older report");
    this.sequence = request.sequence;
    this.lastRequest = key;
    this.declaration =
      request.operation === "clear"
        ? null
        : {
            activityType: request.activityType,
            label: request.label,
            expiresAt: this.now() + ACTIVITY_LIFETIME_MS,
          };
    this.acknowledgment = {
      sequence: request.sequence,
      expiresAt: this.declaration?.expiresAt ?? null,
    };
    this.schedule();
    this.deps.changed();
    return { ...this.acknowledgment };
  }

  /** Revoke immediately on cancellation, project changes, replacement and shutdown. */
  invalidate(): void {
    this.scope = null;
    this.declaration = null;
    this.operations.clear();
    this.ignored.clear();
    this.message = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  stop(): void {
    this.invalidate();
    this.outcome = "stopping";
  }

  event(event: RunEvent): void {
    if (event.type === "prompt") {
      this.invalidate();
      this.scope = this.newScope();
      this.sequence = 0;
      this.lastRequest = "";
      this.acknowledgment = { sequence: 0, expiresAt: null };
      this.outcome = undefined;
      this.order = 0;
      return;
    }
    if (event.type === "turnEnd") {
      this.outcome = event.outcome && event.outcome !== "finished" ? event.outcome : undefined;
      this.invalidate();
      return;
    }
    if (event.type === "status" && (event.status === "idle" || terminal.has(event.status))) {
      this.invalidate();
      return;
    }
    if (this.scope === null) return;
    if (event.type === "message" && event.text.length > 0) {
      this.message = { until: this.now() + ACTIVITY_MESSAGE_MS, order: ++this.order };
    } else if (
      event.type === "acp" &&
      !event.truncated &&
      (event.update === "tool_call" || event.update === "tool_call_update")
    ) {
      // Only an explicit structured name can identify our tools; never inspect titles or prose.
      try {
        const raw: unknown = JSON.parse(event.payload);
        if (
          raw &&
          typeof raw === "object" &&
          "toolCallId" in raw &&
          typeof raw.toolCallId === "string" &&
          "name" in raw &&
          typeof raw.name === "string" &&
          isActivityTool(raw.name)
        ) {
          this.ignored.add(raw.toolCallId);
          this.operations.delete(`acp:${raw.toolCallId}`);
        }
      } catch {
        /* Clipped/malformed diagnostic payload is not activity evidence. */
      }
    } else if (event.type === "toolCall" && !this.ignored.has(event.toolCallId)) {
      const id = `acp:${event.toolCallId}`;
      if (["completed", "failed", "cancelled"].includes(event.status)) this.operations.delete(id);
      else {
        const previous = this.operations.get(id);
        const state = toolStates[event.kind] ?? "working";
        const order = previous?.order ?? ++this.order;
        this.operations.set(id, { state, order, pending: event.status === "pending" });
        // Generic adapter/display calls must not interrupt message streaming or declarations.
        if (
          state !== "working" &&
          (!previous || (previous.pending && event.status === "in_progress"))
        )
          this.message = undefined;
      }
    }
    this.schedule();
  }

  /** Host-owned operations cannot be supplied or completed by a model. */
  beginOperation(state: "dispatching" | "sending" | "receiving"): () => void {
    if (!this.scope) return () => {};
    const scope = this.scope;
    const id = `host:${++this.order}`;
    this.operations.set(id, { state, order: this.order, pending: false });
    this.message = undefined;
    this.deps.changed();
    return () => {
      if (scope !== this.scope) return;
      this.operations.delete(id);
      this.deps.changed();
    };
  }

  received(): void {
    if (!this.scope) return;
    const id = `host:${++this.order}`;
    this.operations.set(id, {
      state: "receiving",
      order: this.order,
      pending: false,
      until: this.now() + 250,
    });
    this.message = undefined;
    this.schedule();
    this.deps.changed();
  }

  snapshot(run: RunView | null, error: string | null, workerCount: number): ActivitySnapshot {
    this.expire();
    const declaration = this.declaration ? { ...this.declaration } : null;
    const make = (
      state: ActivityState,
      source: ActivitySnapshot["source"] = "host",
      urgent = false,
      otherOperations = 0,
      active = false,
    ): ActivitySnapshot => ({
      state,
      source,
      urgent,
      otherOperations,
      workerCount,
      active,
      declaration,
      label:
        source === "declared" && declaration ? declaration.label : (labels[state] ?? "Working"),
    });
    if (error) return make("failed", "host", true);
    if (run && terminal.has(run.status)) return make(run.status as ActivityState, "host", true);
    if (run?.stopping || this.outcome === "stopping") return make("stopping", "host", true);
    if (run?.status === "waiting") return make("waiting_for_approval", "host", true);
    if (run?.status === "queued" || (run?.status === "running" && run.turns === 0))
      return make("connecting");
    if (run?.status === "running" && this.scope) {
      const operations = [...this.operations.values()].sort((a, b) => b.order - a.order);
      const latest = operations.find((operation) => !declaration || operation.state !== "working");
      if (this.message) return make("responding", "observed", false, operations.length, true);
      if (latest)
        return make(
          latest.pending ? "preparing" : latest.state,
          "observed",
          false,
          operations.length - 1,
          true,
        );
      if (declaration)
        return make(declaration.activityType, "declared", false, operations.length, true);
      return make("working", "host", false, 0, true);
    }
    if (run?.status === "running") return make("working", "host", false, 0, true);
    if (this.outcome) return make(this.outcome, "host", true);
    return make(workerCount > 0 ? "waiting_for_workers" : "idle", "host", true);
  }

  private expire(): void {
    const now = this.now();
    if (this.declaration && this.declaration.expiresAt <= now) this.declaration = null;
    if (this.message && this.message.until <= now) this.message = undefined;
    for (const [id, operation] of this.operations)
      if (operation.until !== undefined && operation.until <= now) this.operations.delete(id);
  }
  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const deadlines = [
      this.declaration?.expiresAt,
      this.message?.until,
      ...[...this.operations.values()].map((operation) => operation.until),
    ].filter((value): value is number => value !== undefined);
    if (deadlines.length === 0) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.expire();
        this.schedule();
        this.deps.changed();
      },
      Math.max(0, Math.min(...deadlines) - this.now()),
    );
    this.timer.unref?.();
  }
}
