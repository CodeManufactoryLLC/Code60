import { type MouseEvent, memo, type ReactNode, useMemo, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { type DesktopApi, parseWebLink } from "../bridge/index.js";

type OpenLink = DesktopApi["openWebLink"];
const plugins = [remarkGfm];

function ChatLink({
  href,
  children,
  openLink,
}: {
  href?: string | undefined;
  children?: ReactNode;
  openLink: OpenLink;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  let url: string | undefined;
  try {
    url = parseWebLink({ url: href }).url;
  } catch {
    // Unsafe schemes, local paths and malformed destinations remain non-clickable text.
  }
  if (!url) return <>{children}</>;
  const destination = url;
  async function activate(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (inFlight.current || (event.button !== 0 && event.button !== 1)) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await openLink({ url: destination });
    } catch {
      setError("Could not open link. Activate it to try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <span className="chat-markdown-link">
      <a
        href={url}
        title={url}
        aria-label={`${typeof children === "string" ? `${children}: ` : ""}${url} (opens browser after confirmation)`}
        aria-disabled={pending || undefined}
        onClick={(event) => void activate(event)}
        onAuxClick={(event) => void activate(event)}
        draggable={false}
      >
        {children}
      </a>
      {error && (
        <span className="chat-markdown-link-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** Only agent replies use this renderer. Source text remains the transcript/Copy value. */
export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  openLink,
}: {
  text: string;
  openLink: OpenLink;
}) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => (
        <ChatLink key={href} href={href} openLink={openLink}>
          {children}
        </ChatLink>
      ),
      img: ({ alt }) => <span className="chat-markdown-image">{alt || "[Image omitted]"}</span>,
      table: ({ children }) => (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The horizontal scroll region must be keyboard accessible.
        <section className="chat-markdown-table" aria-label="Table" tabIndex={0}>
          <table>{children}</table>
        </section>
      ),
    }),
    [openLink],
  );
  return (
    <div className="chat-markdown">
      <Markdown remarkPlugins={plugins} components={components}>
        {text}
      </Markdown>
    </div>
  );
});
