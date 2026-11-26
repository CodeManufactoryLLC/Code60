import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApplicationClient } from "../bridge/index.js";
import { handleTerminalKeyEvent, TerminalPanel } from "./terminal-panel.js";

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

  it("defers macOS Cmd+V to native browser paste without calling clipboard.readText (avoiding double paste)", () => {
    const preventDefault = vi.fn();
    const readText = vi.fn(async () => "echo hi\n");
    const paste = vi.fn();
    const handled = handleTerminalKeyEvent(
      {
        type: "keydown",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        key: "v",
        preventDefault,
      },
      {
        mac: true,
        hasSelection: () => false,
        getSelection: () => "",
        paste,
        clipboard: { readText, writeText: vi.fn() },
        isDisposed: () => false,
      },
    );
    expect(handled).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
  });

  it("handles non-macOS Ctrl+Shift+V with preventDefault and a single clipboard paste", async () => {
    const preventDefault = vi.fn();
    const readText = vi.fn(async () => "git init\n");
    const paste = vi.fn();
    const handled = handleTerminalKeyEvent(
      {
        type: "keydown",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        key: "V",
        preventDefault,
      },
      {
        mac: false,
        hasSelection: () => false,
        getSelection: () => "",
        paste,
        clipboard: { readText, writeText: vi.fn() },
        isDisposed: () => false,
      },
    );
    expect(handled).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(paste).toHaveBeenCalledWith("git init\n"));
    expect(paste).toHaveBeenCalledTimes(1);
  });

  it("copies terminal selection on macOS Cmd+C and bubbles global shortcuts", () => {
    const preventDefault = vi.fn();
    const writeText = vi.fn(async () => {});
    const copyResult = handleTerminalKeyEvent(
      {
        type: "keydown",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        key: "c",
        preventDefault,
      },
      {
        mac: true,
        hasSelection: () => true,
        getSelection: () => "selected text",
        paste: vi.fn(),
        clipboard: { readText: vi.fn(), writeText },
        isDisposed: () => false,
      },
    );
    expect(copyResult).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("selected text");

    const globalShortcut = handleTerminalKeyEvent(
      {
        type: "keydown",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        key: "k",
        preventDefault: vi.fn(),
      },
      {
        mac: true,
        hasSelection: () => false,
        getSelection: () => "",
        paste: vi.fn(),
        clipboard: undefined,
        isDisposed: () => false,
      },
    );
    expect(globalShortcut).toBe(false);
  });
});
