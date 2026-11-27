import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  ALERT_LIMITS,
  ALERT_SCHEMA_VERSION,
  type AlertRecord,
  type AlertRequest,
  type AlertSeverity,
  type AlertSnapshot,
  type AlertStateFile,
  type AlertTarget,
  alertStateFileSchema,
  alertTargetSchema,
} from "../bridge/index.js";
import {
  fileCode,
  privateDirectory,
  readPrivateJson,
  writePrivateJson,
} from "../platform/index.js";

export interface AlertInput {
  dedupeKey?: string;
  source: string;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  target: AlertTarget;
}

const SOURCE_RE = /^[a-z][a-z0-9-]{0,63}$/;

function clampText(value: string, max: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function normalizeInput(input: AlertInput): AlertInput {
  const title = clampText(input.title, ALERT_LIMITS.maxTitle);
  if (!title) throw new Error("Alert title cannot be empty.");
  const source = SOURCE_RE.test(input.source) ? input.source : "system";
  const detail = input.detail ? clampText(input.detail, ALERT_LIMITS.maxDetail) : undefined;
  const dedupeKey = input.dedupeKey?.trim()
    ? input.dedupeKey.trim().slice(0, ALERT_LIMITS.maxDedupeKey)
    : undefined;
  const target = alertTargetSchema.parse(input.target);
  return {
    ...(dedupeKey ? { dedupeKey } : {}),
    source,
    severity: input.severity,
    title,
    ...(detail ? { detail } : {}),
    target,
  };
}

function sameAlertContent(existing: AlertRecord, next: AlertInput): boolean {
  return (
    existing.source === next.source &&
    existing.severity === next.severity &&
    existing.title === next.title &&
    existing.detail === next.detail &&
    isDeepStrictEqual(existing.target, next.target)
  );
}

function sortAlerts(alerts: AlertRecord[]): AlertRecord[] {
  return [...alerts].sort((left, right) => {
    const updated = right.updatedAt.localeCompare(left.updatedAt);
    if (updated !== 0) return updated;
    const created = right.createdAt.localeCompare(left.createdAt);
    if (created !== 0) return created;
    return right.id.localeCompare(left.id);
  });
}

function trimAlerts(alerts: AlertRecord[], maxItems: number): AlertRecord[] {
  const ordered = sortAlerts(alerts);
  if (ordered.length <= maxItems) return ordered;
  // Evict oldest read alerts first, then oldest unread alerts.
  const keep = [...ordered];
  while (keep.length > maxItems) {
    let removeIndex = -1;
    for (let i = keep.length - 1; i >= 0; i--) {
      if (keep[i]?.read) {
        removeIndex = i;
        break;
      }
    }
    if (removeIndex < 0) removeIndex = keep.length - 1;
    keep.splice(removeIndex, 1);
  }
  return keep;
}

/**
 * Backend-owned app-wide alert center with private atomic JSON persistence.
 * Human-only: never exposed to agents, MCP gateways, or awareness reports.
 */
export class AlertService {
  private readonly statePath: string;
  private alerts: AlertRecord[] = [];
  private dismissedKeys: string[] = [];
  private seededSchedulerHistory = false;
  private revision = 0;
  private persisted: AlertStateFile | undefined;
  private persistenceEnabled = false;
  private loaded = false;
  private readonly maxItems: number;
  private writes: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(snapshot: AlertSnapshot) => void>();

  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date(),
    maxItems: number = ALERT_LIMITS.maxItems,
  ) {
    this.statePath = join(root, "state.json");
    this.maxItems = Math.max(1, Math.min(ALERT_LIMITS.maxItems, Math.floor(maxItems)));
  }

  get schedulerHistorySeeded(): boolean {
    return this.seededSchedulerHistory;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      await privateDirectory(this.root);
      const raw = await readPrivateJson(this.statePath, ALERT_LIMITS.maxStateBytes);
      const parsed = alertStateFileSchema.safeParse(raw, { jitless: true });
      if (!parsed.success) {
        // Preserve damaged state untouched; continue in non-persisting memory mode.
        this.persistenceEnabled = false;
        return;
      }
      this.persisted = structuredClone(parsed.data);
      this.alerts = trimAlerts(parsed.data.alerts, this.maxItems);
      this.dismissedKeys = [...parsed.data.dismissedKeys].slice(-ALERT_LIMITS.maxDismissedKeys);
      this.seededSchedulerHistory = parsed.data.seededSchedulerHistory === true;
      this.persistenceEnabled = true;
    } catch (error) {
      if (fileCode(error) === "ENOENT") {
        this.persisted = undefined;
        this.persistenceEnabled = true;
      } else {
        this.persistenceEnabled = false;
      }
    }
  }

  snapshot(): AlertSnapshot {
    const alerts = this.alerts.map((alert) => structuredClone(alert));
    const unreadCount = alerts.reduce((sum, alert) => sum + (alert.read ? 0 : 1), 0);
    return {
      revision: this.revision,
      unreadCount,
      alerts,
    };
  }

  subscribe(listener: (snapshot: AlertSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch {
        /* Subscriber errors must not disrupt alert state updates. */
      }
    }
  }

  private recordDismissedKey(key: string | undefined): void {
    if (!key) return;
    const existingIndex = this.dismissedKeys.indexOf(key);
    if (existingIndex >= 0) this.dismissedKeys.splice(existingIndex, 1);
    this.dismissedKeys.push(key);
    if (this.dismissedKeys.length > ALERT_LIMITS.maxDismissedKeys) {
      this.dismissedKeys.splice(0, this.dismissedKeys.length - ALERT_LIMITS.maxDismissedKeys);
    }
  }

  private forgetDismissedKey(key: string): boolean {
    const index = this.dismissedKeys.indexOf(key);
    if (index < 0) return false;
    this.dismissedKeys.splice(index, 1);
    return true;
  }

  private buildStateFile(): AlertStateFile {
    const dismissedKeys = [...this.dismissedKeys].slice(-ALERT_LIMITS.maxDismissedKeys);
    let alerts = trimAlerts(this.alerts, this.maxItems);
    const build = (): AlertStateFile => ({
      format: ALERT_SCHEMA_VERSION,
      ...(this.seededSchedulerHistory ? { seededSchedulerHistory: true } : {}),
      dismissedKeys,
      alerts,
    });
    let state = build();
    while (
      alerts.length > 0 &&
      Buffer.byteLength(`${JSON.stringify(state)}\n`) > ALERT_LIMITS.maxStateBytes
    ) {
      alerts = trimAlerts(alerts, alerts.length - 1);
      state = build();
    }
    return state;
  }

  private schedulePersist(): Promise<void> {
    if (!this.persistenceEnabled) return Promise.resolve();
    const task = this.writes.then(async () => {
      if (!this.persistenceEnabled) return;
      const next = this.buildStateFile();
      if (this.persisted !== undefined && isDeepStrictEqual(next, this.persisted)) return;
      try {
        await privateDirectory(this.root);
        await writePrivateJson(this.statePath, next, this.persisted, ALERT_LIMITS.maxStateBytes);
        this.persisted = structuredClone(next);
      } catch {
        // Never overwrite uncertain external changes or crash callers on disk errors.
        this.persistenceEnabled = false;
      }
    });
    this.writes = task.catch(() => {});
    return task;
  }

  private commit(changed: boolean, notify = true): Promise<void> {
    if (!changed) return Promise.resolve();
    this.alerts = trimAlerts(this.alerts, this.maxItems);
    this.revision++;
    if (notify) this.emit();
    return this.schedulePersist();
  }

  async publish(rawInput: AlertInput): Promise<AlertRecord | null> {
    const input = normalizeInput(rawInput);
    if (input.dedupeKey && this.dismissedKeys.includes(input.dedupeKey)) {
      return null;
    }
    const timestamp = this.now().toISOString();
    if (input.dedupeKey) {
      const existing = this.alerts.find((item) => item.dedupeKey === input.dedupeKey);
      if (existing) {
        if (sameAlertContent(existing, input)) return structuredClone(existing);
        existing.source = input.source;
        existing.severity = input.severity;
        existing.title = input.title;
        if (input.detail !== undefined) existing.detail = input.detail;
        else delete existing.detail;
        existing.target = structuredClone(input.target);
        existing.updatedAt = timestamp;
        await this.commit(true);
        return structuredClone(existing);
      }
    }
    const created: AlertRecord = {
      id: randomUUID(),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      source: input.source,
      severity: input.severity,
      title: input.title,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      target: structuredClone(input.target),
      read: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.alerts.unshift(created);
    await this.commit(true);
    return structuredClone(created);
  }

  /**
   * Synchronizes all live alerts whose `dedupeKey` starts with `keyPrefix`.
   * Active conditions are upserted (preserving read status when unchanged);
   * cleared conditions are automatically removed and unsuppressed for future recurrences.
   */
  async syncSource(keyPrefix: string, rawInputs: readonly AlertInput[]): Promise<void> {
    if (!keyPrefix) throw new Error("Alert sync prefix cannot be empty.");
    const activeByKey = new Map<string, AlertInput>();
    for (const raw of rawInputs) {
      const normalized = normalizeInput(raw);
      if (!normalized.dedupeKey?.startsWith(keyPrefix)) continue;
      activeByKey.set(normalized.dedupeKey, normalized);
    }

    let changed = false;
    let stateChanged = false;
    const timestamp = this.now().toISOString();

    // Remove alerts under this prefix that are no longer active.
    const surviving: AlertRecord[] = [];
    for (const alert of this.alerts) {
      if (alert.dedupeKey?.startsWith(keyPrefix) && !activeByKey.has(alert.dedupeKey)) {
        changed = true;
        continue;
      }
      surviving.push(alert);
    }
    if (changed) this.alerts = surviving;

    // Forget dismissed keys under this prefix once the underlying condition has cleared
    // so a future recurrence creates a fresh alert.
    for (const key of [...this.dismissedKeys]) {
      if (key.startsWith(keyPrefix) && !activeByKey.has(key)) {
        if (this.forgetDismissedKey(key)) stateChanged = true;
      }
    }

    // Upsert active items.
    for (const [key, input] of activeByKey) {
      if (this.dismissedKeys.includes(key)) continue;
      const existing = this.alerts.find((item) => item.dedupeKey === key);
      if (existing) {
        if (sameAlertContent(existing, input)) continue;
        existing.source = input.source;
        existing.severity = input.severity;
        existing.title = input.title;
        if (input.detail !== undefined) existing.detail = input.detail;
        else delete existing.detail;
        existing.target = structuredClone(input.target);
        existing.updatedAt = timestamp;
        changed = true;
      } else {
        this.alerts.unshift({
          id: randomUUID(),
          dedupeKey: key,
          source: input.source,
          severity: input.severity,
          title: input.title,
          ...(input.detail !== undefined ? { detail: input.detail } : {}),
          target: structuredClone(input.target),
          read: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        changed = true;
      }
    }

    if (changed) {
      await this.commit(true);
    } else if (stateChanged) {
      await this.schedulePersist();
    }
  }

  async resolve(dedupeKey: string): Promise<void> {
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((alert) => alert.dedupeKey !== dedupeKey);
    const forgot = this.forgetDismissedKey(dedupeKey);
    if (this.alerts.length !== before) {
      await this.commit(true);
    } else if (forgot) {
      await this.schedulePersist();
    }
  }

  async markSchedulerHistorySeeded(existingExecutionKeys: readonly string[]): Promise<void> {
    if (this.seededSchedulerHistory) return;
    this.seededSchedulerHistory = true;
    for (const key of existingExecutionKeys) {
      this.recordDismissedKey(key.slice(0, ALERT_LIMITS.maxDedupeKey));
    }
    await this.schedulePersist();
  }

  async handle(request: AlertRequest): Promise<AlertSnapshot> {
    switch (request.action) {
      case "list":
        return this.snapshot();
      case "mark-read": {
        const target = this.alerts.find((alert) => alert.id === request.id);
        if (target && !target.read) {
          target.read = true;
          await this.commit(true);
        }
        return this.snapshot();
      }
      case "mark-unread": {
        const target = this.alerts.find((alert) => alert.id === request.id);
        if (target?.read) {
          target.read = false;
          await this.commit(true);
        }
        return this.snapshot();
      }
      case "mark-all-read": {
        let changed = false;
        for (const alert of this.alerts) {
          if (!alert.read) {
            alert.read = true;
            changed = true;
          }
        }
        if (changed) await this.commit(true);
        return this.snapshot();
      }
      case "dismiss": {
        const index = this.alerts.findIndex((alert) => alert.id === request.id);
        if (index >= 0) {
          const [removed] = this.alerts.splice(index, 1);
          this.recordDismissedKey(removed?.dedupeKey);
          await this.commit(true);
        }
        return this.snapshot();
      }
      case "clear-read": {
        let changed = false;
        const remaining: AlertRecord[] = [];
        for (const alert of this.alerts) {
          if (alert.read) {
            this.recordDismissedKey(alert.dedupeKey);
            changed = true;
          } else {
            remaining.push(alert);
          }
        }
        if (changed) {
          this.alerts = remaining;
          await this.commit(true);
        }
        return this.snapshot();
      }
    }
  }

  async close(): Promise<void> {
    await this.writes;
  }
}
