import type { SessionUpdate } from "@agentclientprotocol/sdk";
import {
  type AcpCost,
  acpCostSchema,
  acpReportedUsageSchema,
  type UsageAttribution,
  type UsageContextSnapshot,
  type UsageTurnObservation,
} from "../contracts/index.js";

const CODE_SAMPLE_LIMIT = 65_536;
const TOOL_PAYLOAD_SAMPLE_LIMIT = 131_072;
const MAX_SNAPSHOTS = 64;

const CODE_CHAR_RE = /[{}[\]()<>:=;`"\\/|&*+-]/;

function sampleCodeChars(text: string, limit: number): { sampled: number; codeHits: number } {
  const slice = text.length > limit ? text.slice(0, limit) : text;
  let codeHits = 0;
  for (let index = 0; index < slice.length; index++) {
    const ch = slice[index];
    if (ch && CODE_CHAR_RE.test(ch)) codeHits++;
  }
  return { sampled: slice.length, codeHits };
}

function ratio(hits: number, sampled: number): number {
  if (sampled <= 0) return 0;
  // Code typically has 6-15%+ syntax/punctuation characters; map [0.02..0.14] into [0..1].
  const density = hits / sampled;
  return Math.max(0, Math.min(1, (density - 0.02) / 0.12));
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function serializedSize(value: unknown): { chars: number; bytes: number } {
  if (value == null) return { chars: 0, bytes: 0 };
  if (typeof value === "string") {
    const clipped =
      value.length > TOOL_PAYLOAD_SAMPLE_LIMIT ? value.slice(0, TOOL_PAYLOAD_SAMPLE_LIMIT) : value;
    return { chars: value.length, bytes: byteLength(clipped) };
  }
  try {
    const text = JSON.stringify(value);
    if (!text) return { chars: 0, bytes: 0 };
    const clipped =
      text.length > TOOL_PAYLOAD_SAMPLE_LIMIT ? text.slice(0, TOOL_PAYLOAD_SAMPLE_LIMIT) : text;
    return { chars: text.length, bytes: byteLength(clipped) };
  } catch {
    return { chars: 0, bytes: 0 };
  }
}

interface ActiveTurn {
  turn: number;
  startedAtMs: number;
  promptChars: number;
  promptBytes: number;
  promptCodeRatio: number;
  messageChars: number;
  messageBytes: number;
  messageSampled: number;
  messageCodeHits: number;
  thoughtChars: number;
  thoughtBytes: number;
  toolCallCount: number;
  toolWaves: number;
  inToolWave: boolean;
  toolPayloadChars: number;
  toolPayloadBytes: number;
  rawAcpBytes: number;
  usedBefore: number | null;
  usedAfter: number | null;
  peakUsed: number | null;
  windowSize: number | null;
  snapshots: UsageContextSnapshot[];
  updatesCount: number;
  compacted: boolean;
  costBefore: AcpCost | null;
  costAfter: AcpCost | null;
}

const DEFAULT_ATTRIBUTION: UsageAttribution = { surface: "worker" };

/**
 * Collects quantitative, payload-free turn telemetry across one ACP session.
 * Never retains prompt/reply text or raw tool arguments.
 */
export class SessionUsageCollector {
  private turnCount = 0;
  private active: ActiveTurn | undefined;
  private lastUsed: number | null = null;
  private lastSize: number | null = null;
  private lastCost: AcpCost | null = null;

  constructor(
    private readonly provider: string,
    private readonly attribution: UsageAttribution = DEFAULT_ATTRIBUTION,
    private readonly nowMs: () => number = Date.now,
  ) {}

  /** Records `usage_update` context/cost state even before the first turn starts. */
  observeUpdate(update: SessionUpdate, rawBytes: number): void {
    const turn = this.active;
    if (turn) turn.rawAcpBytes += Math.max(0, rawBytes);

    if (update.sessionUpdate === "usage_update") {
      const used =
        typeof update.used === "number" && Number.isSafeInteger(update.used) && update.used >= 0
          ? update.used
          : null;
      const size =
        typeof update.size === "number" && Number.isSafeInteger(update.size) && update.size >= 0
          ? update.size
          : null;
      const parsedCost = acpCostSchema.safeParse(update.cost);
      const cost = parsedCost.success ? parsedCost.data : null;

      if (used !== null && size !== null) {
        if (turn) {
          turn.inToolWave = false;
          turn.updatesCount++;
          if (this.lastUsed !== null && used < this.lastUsed) turn.compacted = true;
          turn.usedAfter = used;
          turn.windowSize = size;
          turn.peakUsed = turn.peakUsed === null ? used : Math.max(turn.peakUsed, used);
          const prev = turn.snapshots.at(-1);
          if (
            turn.snapshots.length < MAX_SNAPSHOTS &&
            (!prev || prev.used !== used || prev.size !== size)
          ) {
            turn.snapshots.push({ used, size });
          }
        }
        this.lastUsed = used;
        this.lastSize = size;
      }
      if (cost) {
        this.lastCost = cost;
        if (turn) turn.costAfter = cost;
      }
      return;
    }

    if (!turn) return;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        turn.inToolWave = false;
        if (update.content.type === "text") {
          const text = update.content.text;
          turn.messageChars += text.length;
          turn.messageBytes += byteLength(text);
          if (turn.messageSampled < CODE_SAMPLE_LIMIT) {
            const sample = sampleCodeChars(text, CODE_SAMPLE_LIMIT - turn.messageSampled);
            turn.messageSampled += sample.sampled;
            turn.messageCodeHits += sample.codeHits;
          }
        }
        break;
      }
      case "agent_thought_chunk": {
        turn.inToolWave = false;
        if (update.content.type === "text") {
          const text = update.content.text;
          turn.thoughtChars += text.length;
          turn.thoughtBytes += byteLength(text);
        }
        break;
      }
      case "tool_call": {
        turn.toolCallCount++;
        if (!turn.inToolWave) {
          turn.toolWaves++;
          turn.inToolWave = true;
        }
        const titleSize = serializedSize(update.title);
        const inputSize = serializedSize(update.rawInput);
        turn.toolPayloadChars += titleSize.chars + inputSize.chars;
        turn.toolPayloadBytes += titleSize.bytes + inputSize.bytes;
        break;
      }
      case "tool_call_update": {
        const outputSize = serializedSize(update.rawOutput);
        const contentSize = serializedSize(update.content);
        turn.toolPayloadChars += outputSize.chars + contentSize.chars;
        turn.toolPayloadBytes += outputSize.bytes + contentSize.bytes;
        break;
      }
      case "compaction_update": {
        turn.compacted = true;
        turn.inToolWave = false;
        break;
      }
      default:
        break;
    }
  }

  startTurn(promptText: string): void {
    const sample = sampleCodeChars(promptText, CODE_SAMPLE_LIMIT);
    this.turnCount++;
    this.active = {
      turn: this.turnCount,
      startedAtMs: this.nowMs(),
      promptChars: promptText.length,
      promptBytes: byteLength(promptText),
      promptCodeRatio: ratio(sample.codeHits, sample.sampled),
      messageChars: 0,
      messageBytes: 0,
      messageSampled: 0,
      messageCodeHits: 0,
      thoughtChars: 0,
      thoughtBytes: 0,
      toolCallCount: 0,
      toolWaves: 0,
      inToolWave: false,
      toolPayloadChars: 0,
      toolPayloadBytes: 0,
      rawAcpBytes: 0,
      usedBefore: this.lastUsed,
      usedAfter: this.lastUsed,
      peakUsed: this.lastUsed,
      windowSize: this.lastSize,
      snapshots: [],
      updatesCount: 0,
      compacted: false,
      costBefore: this.lastCost,
      costAfter: this.lastCost,
    };
  }

  finishTurn(options: {
    sessionId: string;
    model: string | null;
    stopReason: string;
    rawResponse?: unknown;
  }): UsageTurnObservation | undefined {
    const turn = this.active;
    if (!turn) return undefined;
    this.active = undefined;

    const endedAtMs = this.nowMs();
    const durationMs = Math.max(0, Math.round(endedAtMs - turn.startedAtMs));
    const rawUsage =
      options.rawResponse && typeof options.rawResponse === "object"
        ? (options.rawResponse as { usage?: unknown }).usage
        : undefined;
    const parsedUsage = acpReportedUsageSchema.safeParse(rawUsage);

    let cost: UsageTurnObservation["cost"];
    if (turn.costAfter) {
      const sameCurrency = turn.costBefore?.currency === turn.costAfter.currency;
      const beforeAmount = sameCurrency ? (turn.costBefore?.amount ?? 0) : 0;
      const delta = Math.max(0, Number((turn.costAfter.amount - beforeAmount).toFixed(8)));
      if (delta > 0 || turn.costBefore === null) {
        cost = {
          delta,
          cumulative: turn.costAfter.amount,
          currency: turn.costAfter.currency,
        };
      }
    }

    return {
      at: new Date(endedAtMs).toISOString(),
      provider: this.provider,
      model: options.model,
      sessionId: options.sessionId,
      turn: turn.turn,
      stopReason: options.stopReason.slice(0, 64) || "unknown",
      durationMs,
      attribution: this.attribution,
      ...(parsedUsage.success
        ? { reported: parsedUsage.data, reportedScope: "turn" as const }
        : {}),
      ...(cost ? { cost } : {}),
      context: {
        usedBefore: turn.usedBefore,
        usedAfter: turn.usedAfter,
        peakUsed: turn.peakUsed,
        windowSize: turn.windowSize,
        snapshots: turn.snapshots,
        updatesCount: turn.updatesCount,
        compacted: turn.compacted,
      },
      observed: {
        promptChars: turn.promptChars,
        promptBytes: turn.promptBytes,
        promptCodeRatio: turn.promptCodeRatio,
        messageChars: turn.messageChars,
        messageBytes: turn.messageBytes,
        messageCodeRatio: ratio(turn.messageCodeHits, turn.messageSampled),
        thoughtChars: turn.thoughtChars,
        thoughtBytes: turn.thoughtBytes,
        toolCallCount: turn.toolCallCount,
        toolWaves: turn.toolWaves,
        toolPayloadChars: turn.toolPayloadChars,
        toolPayloadBytes: turn.toolPayloadBytes,
        rawAcpBytes: turn.rawAcpBytes,
      },
    };
  }
}
