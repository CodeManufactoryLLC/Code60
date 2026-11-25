import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApplicationClient } from "../bridge/index.js";
import { TerminalPanel } from "./terminal-panel.js";

describe("TerminalPanel", () => {
  it("renders accessible terminal header and starting viewport", () => {
    const markup = renderToStaticMarkup(
      <TerminalPanel
        api={{} as ApplicationClient}
        target={{ kind: "relay" }}
        label="Relay"
        visible
      />,
    );
    expect(markup).toContain('aria-label="Terminal for Relay"');
    expect(markup).toContain("Starting…");
    expect(markup).toContain('data-terminal-state="connecting"');
  });
});
