import type { RunEvent } from "../core/index.js";
export interface Block {
  type: RunEvent["type"];
  text: string;
  key: string;
  /** Expandable detail, such as the summary a handoff note refers to. */
  detail?: string;
  /** Set on prompts Code60 generated instead of the user. */
  automatic?: boolean;
  mcp?: Extract<RunEvent, { type: "toolCall" }>["mcp"];
}

/** Chat blocks: the text of each event, without speaker, turn, or status labels. */
export function transcript(events: readonly RunEvent[]): Block[] {
  const blocks: Block[] = [];
  const tools = new Map<string, Block>();
  let open: Block | undefined;
  for (const [index, event] of events.entries()) {
    // Raw protocol records must not split the corresponding streamed text message.
    if (event.type === "acp" || event.type === "sessionState") continue;
    if (event.type === "message" || event.type === "thought") {
      if (open?.type === event.type) open.text += event.text;
      else {
        open = { key: String(index), type: event.type, text: event.text };
        blocks.push(open);
      }
      continue;
    }
    open = undefined;
    let text: string;
    switch (event.type) {
      case "status":
      case "turnEnd":
        continue;
      case "prompt":
        if (event.origin === "automatic") {
          blocks.push({ key: String(index), type: event.type, text: event.text, automatic: true });
          continue;
        }
        text = event.text;
        break;
      case "stderr":
        text = event.text;
        break;
      case "toolCall": {
        const existing = tools.get(event.toolCallId);
        text = `${event.title}\n${event.kind} / ${event.status}`;
        if (existing) {
          existing.text = text;
          existing.mcp = event.mcp;
          continue;
        }
        const block: Block = {
          key: String(index),
          type: event.type,
          text,
          ...(event.mcp === undefined ? {} : { mcp: event.mcp }),
        };
        tools.set(event.toolCallId, block);
        blocks.push(block);
        continue;
      }
      case "permission":
        text = `${event.decision} by ${event.by} / ${event.title}`;
        break;
      case "note":
        blocks.push({
          key: String(index),
          type: event.type,
          text: event.text,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        });
        continue;
    }
    blocks.push({ key: String(index), type: event.type, text });
  }
  return blocks;
}
