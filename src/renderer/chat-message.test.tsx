import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatMessage } from "./chat-message.js";

describe("shared chat presentation", () => {
  it("renders safe assistant Markdown and exact-source Copy in an accessible article", () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        block={{ key: "reply", type: "message", text: "**Answer** <script>unsafe()</script>" }}
        openLink={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="Assistant"');
    expect(html).toContain("<strong>Answer</strong>");
    expect(html).not.toContain("<script>");
    expect(html).toContain('aria-label="Copy message"');
    expect(html).not.toContain("chat-message-speaker");
  });
  it("keeps prompt highlighting and worker handoff details in separate slots", () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        block={{
          key: "prompt",
          type: "prompt",
          text: "/review <raw>",
          detail: "not the chosen detail",
        }}
        prompt={<mark>/review</mark>}
        detail={
          <details>
            <summary>Worker handoff</summary>Captured context
          </details>
        }
        eventIndex="12"
        tabIndex={-1}
        openLink={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="You"');
    expect(html).toContain('data-event-index="12"');
    expect(html).toContain("<mark>/review</mark>");
    expect(html).toContain("Captured context");
    expect(html).not.toContain("not the chosen detail");
  });
  it("renders automatic prompts as literal activity without human Copy controls", () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        block={{
          key: "automatic",
          type: "prompt",
          automatic: true,
          text: "**automatic** <unsafe>",
        }}
        openLink={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="Automatic worker update"');
    expect(html).toContain("**automatic** &lt;unsafe&gt;");
    expect(html).not.toContain('aria-label="Copy message"');
  });
});
