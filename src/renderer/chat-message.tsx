import { type ReactNode, useEffect, useState } from "react";
import type { DesktopApi } from "../bridge/index.js";
import { ChatMarkdown } from "./chat-markdown.js";
import { McpBadge } from "./mcp-badge.js";
import { MessageCopy } from "./message-controls.js";
import type { Block } from "./transcript.js";
export function ChatMessage({
  block,
  at,
  prompt,
  detail,
  className = "",
  eventIndex,
  tabIndex,
  openLink,
  incoming = false,
  visible = true,
  onCopied,
  copyable = true,
  readSource,
}: {
  block: Block;
  at?: string | undefined;
  prompt?: ReactNode;
  detail?: ReactNode;
  className?: string;
  eventIndex?: string;
  tabIndex?: number;
  openLink: DesktopApi["openWebLink"];
  incoming?: boolean;
  visible?: boolean;
  onCopied?: (() => void) | undefined;
  copyable?: boolean;
  readSource?: (() => Promise<string>) | undefined;
}) {
  const [entering, setEntering] = useState(incoming);
  useEffect(() => {
    if (!visible) setEntering(false);
  }, [visible]);
  useEffect(() => {
    if (!entering) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const settle = () => {
      if (media.matches || document.visibilityState !== "visible") setEntering(false);
    };
    settle();
    media.addEventListener("change", settle);
    document.addEventListener("visibilitychange", settle);
    return () => {
      media.removeEventListener("change", settle);
      document.removeEventListener("visibilitychange", settle);
    };
  }, [entering]);
  const speaker =
    block.type === "prompt"
      ? block.automatic
        ? "Automatic worker update"
        : "You"
      : block.type === "message"
        ? "Assistant"
        : block.type === "thought"
          ? "Thinking"
          : block.type === "toolCall"
            ? "Tool"
            : block.type === "permission"
              ? "Permission"
              : block.type === "stderr"
                ? "Error"
                : "Session";
  return (
    <article
      className={`event ${block.type}${block.automatic ? " automatic" : ""}${className ? ` ${className}` : ""}`}
      data-event-index={eventIndex}
      tabIndex={tabIndex}
      aria-label={speaker}
      data-entering={entering || undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setEntering(false);
      }}
    >
      {block.type !== "message" && <div className="chat-message-speaker">{speaker}</div>}
      <McpBadge mcp={block.mcp} />
      {block.type === "message" ? (
        <ChatMarkdown text={block.text} openLink={openLink} />
      ) : (
        <pre>
          {block.type === "prompt" && !block.automatic ? (prompt ?? block.text) : block.text}
        </pre>
      )}
      {copyable && (block.type === "message" || (block.type === "prompt" && !block.automatic)) && (
        <MessageCopy
          text={block.text}
          at={at}
          visible={visible}
          onCopied={onCopied}
          readSource={readSource}
        />
      )}
      {detail ?? (block.detail && <pre>{block.detail}</pre>)}
    </article>
  );
}
