import type { DesktopApi, OrchestrationChat, RelayMessageRead } from "../bridge/index.js";
import { ChatMessage } from "./chat-message.js";

/** Only an explicit Copy assembles original source; it never enters transcript/page state. */
export async function readOriginalRelayMessage(
  read: DesktopApi["readRelayMessage"],
  request: Omit<RelayMessageRead, "cursor">,
): Promise<string> {
  const parts: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await read({ ...request, ...(cursor ? { cursor } : {}) });
    if (page.text) parts.push(page.text);
    if (page.cursor === cursor) throw new Error("Relay source cursor did not advance");
    cursor = page.cursor ?? undefined;
  } while (cursor);
  return parts.join("");
}

/** A bounded page is evidence only. It never becomes a live turn or worker authority. */
export function RelayHistoryMessages({
  history,
  openLink,
  visible,
  onCopied,
  conversationId,
  readMessage,
}: {
  history: NonNullable<OrchestrationChat["history"]>;
  openLink: DesktopApi["openWebLink"];
  visible: boolean;
  onCopied?: (() => void) | undefined;
  conversationId?: string | undefined;
  readMessage?: DesktopApi["readRelayMessage"] | undefined;
}) {
  if (!history.messages) return <pre>{history.serialized}</pre>;
  return history.messages.map((message) => {
    const source = message.source;
    const readSource =
      source && conversationId && readMessage
        ? () => readOriginalRelayMessage(readMessage, { conversationId, source })
        : undefined;
    return (
      <ChatMessage
        key={message.id}
        block={{
          key: message.id,
          text: message.text,
          type:
            message.role === "human" ? "prompt" : message.role === "assistant" ? "message" : "note",
        }}
        at={message.at}
        openLink={openLink}
        visible={visible}
        onCopied={onCopied}
        copyable={!message.partial || !!readSource}
        readSource={readSource}
        detail={
          message.partial ? (
            <p>
              Partial excerpt. The original message remains on disk.
              {readSource ? " Copy retrieves the original message." : ""}
            </p>
          ) : undefined
        }
      />
    );
  });
}
