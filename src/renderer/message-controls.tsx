import { useEffect, useRef, useState } from "react";
import { durationText, messageAgeText, type TurnTiming, timingText } from "./chat-presentation.js";
import { Icon } from "./icons.js";
import { useTicker } from "./ticker.js";

export async function copyMessage(
  text: string,
  write: (text: string) => Promise<void>,
): Promise<void> {
  await write(text);
}

function MessageTime({ at, visible }: { at: string | undefined; visible: boolean }) {
  const timestamp = at === undefined ? NaN : Date.parse(at);
  const valid = Number.isFinite(timestamp);
  const now = useTicker(visible && valid);
  return (
    <time
      className="message-sent-time"
      dateTime={valid ? new Date(timestamp).toISOString() : undefined}
      title={valid ? new Date(timestamp).toLocaleString() : "Message time unavailable"}
      aria-live="off"
    >
      {messageAgeText(timestamp, now)}
    </time>
  );
}

export function MessageCopy({
  text,
  at,
  visible = true,
  onCopied,
  readSource,
}: {
  text: string;
  at?: string | undefined;
  visible?: boolean;
  onCopied?: (() => void) | undefined;
  readSource?: (() => Promise<string>) | undefined;
}) {
  const [state, setState] = useState<"idle" | "copying" | "failed">("idle");
  const [press, setPress] = useState(0);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!text.length) return null;
  async function copy() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPress((current) => current + 1);
    setState("copying");
    try {
      const source = readSource ? await readSource() : text;
      await copyMessage(source, (source) => navigator.clipboard.writeText(source));
    } catch {
      if (mounted.current) setState("failed");
      return;
    } finally {
      inFlight.current = false;
    }
    if (mounted.current) {
      setState("idle");
      onCopied?.();
    }
  }
  return (
    <div className="message-copy">
      <MessageTime at={at} visible={visible} />
      <button
        type="button"
        className="icon-button"
        title={`${state === "failed" ? "Retry Copy" : "Copy"} ${readSource ? "original message" : "message"}`}
        aria-label={`${state === "failed" ? "Retry Copy" : "Copy"} ${readSource ? "original message" : "message"}`}
        aria-disabled={state === "copying"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void copy()}
      >
        <span className="message-copy-glyph" key={press} data-clicked={press > 0 || undefined}>
          <Icon name="copy" />
        </span>
      </button>
      <span className="message-copy-feedback" role={state === "failed" ? "status" : undefined}>
        {state === "failed"
          ? readSource
            ? "Copy failed. Refresh history or check clipboard access, then retry."
            : "Copy failed. Check clipboard access and retry."
          : ""}
      </span>
    </div>
  );
}

export function TurnTimer({
  timing,
  visible,
  disclosure,
}: {
  timing: TurnTiming | undefined;
  visible: boolean;
  disclosure?: { id: string; controls: string; expanded: boolean; toggle(): void } | undefined;
}) {
  const now = useTicker(visible && timing?.active === true);
  if (!timing) return null;
  return (
    <>
      {disclosure ? (
        <button
          type="button"
          id={disclosure.id}
          className="turn-timer activity-history-toggle"
          aria-expanded={disclosure.expanded}
          aria-controls={disclosure.controls}
          onClick={disclosure.toggle}
        >
          {timingText(timing, now)}
        </button>
      ) : (
        <p className="turn-timer" aria-live="off">
          {timingText(timing, now)}
        </p>
      )}
      {!timing.active && <hr className="turn-separator" />}
    </>
  );
}

export function MessageAge({ at, scope }: { at: number | null | undefined; scope: string }) {
  const now = useTicker(at !== undefined && at !== null);
  return (
    <span
      role="img"
      title={`Agent text in ${scope}. Polling pause does not pause streaming.`}
      aria-label={`Agent text in ${scope}: ${
        at === undefined
          ? "No messages yet"
          : at === null
            ? "Message time unavailable"
            : `Last message ${durationText(now - at)} ago`
      }`}
    >
      {at === undefined
        ? "No messages yet"
        : at === null || !Number.isFinite(at)
          ? "Message time unavailable"
          : `Last message ${durationText(now - at)} ago`}
    </span>
  );
}
