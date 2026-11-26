import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import {
  type ApplicationClient,
  abbreviateTerminalPath,
  type TerminalTarget,
} from "../bridge/index.js";
import { Icon } from "./icons.js";

function readTerminalTheme(): ITheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const dark = root.dataset.colorScheme === "dark";
  const bg =
    style.getPropertyValue("--cds-layer-01").trim() ||
    style.getPropertyValue("--chat-neutral").trim() ||
    (dark ? "#262626" : "#f4f4f4");
  const fg =
    style.getPropertyValue("--cds-text-primary").trim() ||
    style.getPropertyValue("--text").trim() ||
    (dark ? "#f4f4f4" : "#161616");
  const accent =
    style.getPropertyValue("--cds-interactive").trim() ||
    style.getPropertyValue("--accent").trim() ||
    (dark ? "#4589ff" : "#0f62fe");
  const selection =
    style.getPropertyValue("--cds-layer-selected-01").trim() ||
    style.getPropertyValue("--hover-bg").trim() ||
    (dark ? "#393939" : "#e0e0e0");
  if (dark) {
    return {
      background: bg,
      foreground: fg,
      cursor: accent,
      cursorAccent: bg,
      selectionBackground: selection,
      black: "#262626",
      red: "#fa4d56",
      green: "#42be65",
      yellow: "#f1c21b",
      blue: "#78a9ff",
      magenta: "#d4bbff",
      cyan: "#3ddbd9",
      white: "#f4f4f4",
      brightBlack: "#8d8d8d",
      brightRed: "#ff8389",
      brightGreen: "#6fdc8c",
      brightYellow: "#fdd13a",
      brightBlue: "#a6c8ff",
      brightMagenta: "#e8daff",
      brightCyan: "#82cfff",
      brightWhite: "#ffffff",
    };
  }
  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: selection,
    black: "#161616",
    red: "#da1e28",
    green: "#198038",
    yellow: "#8e6a00",
    blue: "#0f62fe",
    magenta: "#8a3ffc",
    cyan: "#007d79",
    white: "#525252",
    brightBlack: "#6f6f6f",
    brightRed: "#a2191f",
    brightGreen: "#24a148",
    brightYellow: "#b28600",
    brightBlue: "#0043ce",
    brightMagenta: "#6929c4",
    brightCyan: "#005d5d",
    brightWhite: "#000000",
  };
}

function readMonoFont(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() ||
    "ui-monospace, SFMono-Regular, Menlo, monospace"
  );
}

type TerminalPhase =
  | { state: "connecting" }
  | { state: "running"; cwd: string; displayCwd: string; shell: string }
  | {
      state: "exited";
      cwd: string;
      displayCwd: string;
      shell: string;
      code: number | null;
      signal: string | null;
    }
  | { state: "error"; message: string };

/**
 * Custom xterm.js key handler: lets global Code60 shortcuts bubble, handles copy/paste
 * without double-pasting on macOS (where Cmd+V triggers the browser's native paste event).
 */
export function handleTerminalKeyEvent(
  event: Pick<
    KeyboardEvent,
    "type" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "key" | "preventDefault"
  >,
  options: {
    mac: boolean;
    hasSelection(): boolean;
    getSelection(): string;
    paste(text: string): void;
    clipboard?: Pick<Clipboard, "readText" | "writeText"> | undefined;
    isDisposed(): boolean;
  },
): boolean {
  if (event.type !== "keydown") return true;
  const { mac, clipboard } = options;
  const mod = mac ? event.metaKey : event.ctrlKey;
  // Let Code60 global shortcuts bubble out of the terminal.
  if (mod && !event.altKey && (event.key.toLowerCase() === "k" || event.key === ",")) {
    return false;
  }
  const isCopy = mac
    ? event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "c"
    : event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c";
  if (isCopy && options.hasSelection()) {
    const text = options.getSelection();
    if (text && clipboard?.writeText) {
      event.preventDefault();
      void clipboard.writeText(text).catch(() => {});
    }
    return false;
  }
  if (mac && event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "v") {
    // Returning false without preventDefault lets the browser fire one native paste event,
    // which xterm.js handles directly via its built-in paste listener (avoiding double paste).
    return false;
  }
  const isLinuxPaste = !mac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v";
  if (isLinuxPaste && clipboard?.readText) {
    event.preventDefault();
    void clipboard
      .readText()
      .then((text) => {
        if (!options.isDisposed() && text) options.paste(text);
      })
      .catch(() => {});
    return false;
  }
  return true;
}

/** Interactive xterm.js panel pinned to one opaque agent/project terminal target. */
export function TerminalPanel({
  api,
  target,
  label,
  visible,
}: {
  api: ApplicationClient;
  target: TerminalTarget;
  label: string;
  visible: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
  const [generation, setGeneration] = useState(0);
  const [phase, setPhase] = useState<TerminalPhase>({ state: "connecting" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: target is pinned per tab; generation triggers explicit restarts.
  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;
    if (
      !api.openTerminal ||
      !api.writeTerminal ||
      !api.resizeTerminal ||
      !api.closeTerminal ||
      !api.onTerminalEvent
    ) {
      setPhase({ state: "error", message: "Terminal bridge is unavailable." });
      return;
    }

    let disposed = false;
    sessionIdRef.current = null;
    setPhase({ state: "connecting" });

    const terminal = new Terminal({
      cursorBlink: false,
      fontFamily: readMonoFont(),
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: readTerminalTheme(),
      allowProposedApi: false,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    termRef.current = terminal;
    fitRef.current = fitAddon;

    const mac =
      typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
    terminal.attachCustomKeyEventHandler((event) =>
      handleTerminalKeyEvent(event, {
        mac,
        hasSelection: () => terminal.hasSelection(),
        getSelection: () => terminal.getSelection(),
        paste: (text) => terminal.paste(text),
        clipboard: typeof navigator !== "undefined" ? navigator.clipboard : undefined,
        isDisposed: () => disposed,
      }),
    );

    const measure = () => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit when hidden / zero-sized.
      }
      const cols = Math.max(2, Math.min(500, terminal.cols || 80));
      const rows = Math.max(1, Math.min(200, terminal.rows || 24));
      return { cols, rows };
    };
    const initial = measure();
    lastSizeRef.current = initial;

    // Serialize writes in strict order so fast typing never overflows gateway concurrency limits.
    let pendingWrite = "";
    let writing = false;
    const flushWrites = () => {
      if (disposed || writing || !pendingWrite) return;
      const id = sessionIdRef.current;
      if (!id) {
        pendingWrite = "";
        return;
      }
      const chunk = pendingWrite.slice(0, 16 * 1024);
      pendingWrite = pendingWrite.slice(chunk.length);
      writing = true;
      void api
        .writeTerminal?.({ id, data: chunk })
        .catch(() => {})
        .finally(() => {
          writing = false;
          if (!disposed && pendingWrite) flushWrites();
        });
    };

    const dataDisposable = terminal.onData((data) => {
      if (disposed || !sessionIdRef.current || !data) return;
      pendingWrite += data;
      flushWrites();
    });

    const bufferedBeforeOpen: { id: string; data: string }[] = [];
    const unsubscribeEvents = api.onTerminalEvent((event) => {
      if (disposed) return;
      const activeId = sessionIdRef.current;
      if (!activeId) {
        if (event.type === "data") bufferedBeforeOpen.push({ id: event.id, data: event.data });
        return;
      }
      if (event.id !== activeId) return;
      if (event.type === "data") {
        terminal.write(event.data);
      } else if (event.type === "exit") {
        sessionIdRef.current = null;
        pendingWrite = "";
        setPhase((current) => ({
          state: "exited",
          cwd: current.state === "running" ? current.cwd : "",
          displayCwd: current.state === "running" ? current.displayCwd : "",
          shell: current.state === "running" ? current.shell : "",
          code: event.code,
          signal: event.signal,
        }));
      }
    });

    const themeObserver = new MutationObserver(() => {
      if (!disposed) {
        terminal.options.theme = readTerminalTheme();
        terminal.options.fontFamily = readMonoFont();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme", "data-theme", "data-signals", "style", "class"],
    });

    void api
      .openTerminal({ target, cols: initial.cols, rows: initial.rows })
      .then((info) => {
        if (disposed) {
          void api.closeTerminal?.({ id: info.id }).catch(() => {});
          return;
        }
        sessionIdRef.current = info.id;
        setPhase({
          state: "running",
          cwd: info.cwd,
          displayCwd: info.displayCwd ?? abbreviateTerminalPath(info.cwd),
          shell: info.shell,
        });
        for (const chunk of bufferedBeforeOpen.splice(0)) {
          if (chunk.id === info.id) terminal.write(chunk.data);
        }
        const fitted = measure();
        if (fitted.cols !== initial.cols || fitted.rows !== initial.rows) {
          lastSizeRef.current = fitted;
          void api
            .resizeTerminal?.({ id: info.id, cols: fitted.cols, rows: fitted.rows })
            .catch(() => {});
        }
      })
      .catch((cause) => {
        if (disposed) return;
        setPhase({
          state: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });

    const focusOnPointerDown = () => {
      if (!disposed) terminal.focus();
    };
    container.addEventListener("mousedown", focusOnPointerDown);

    return () => {
      disposed = true;
      pendingWrite = "";
      container.removeEventListener("mousedown", focusOnPointerDown);
      themeObserver.disconnect();
      unsubscribeEvents();
      dataDisposable.dispose();
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (id) void api.closeTerminal?.({ id }).catch(() => {});
      terminal.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [api, generation]);

  useEffect(() => {
    const container = hostRef.current;
    if (!visible || !container) return;
    let frame = 0;
    const syncSize = () => {
      const terminal = termRef.current;
      const fitAddon = fitRef.current;
      if (!terminal || !fitAddon) return;
      const rect = container.getBoundingClientRect();
      if (rect.width < 16 || rect.height < 16) return;
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const cols = Math.max(2, Math.min(500, terminal.cols || 80));
      const rows = Math.max(1, Math.min(200, terminal.rows || 24));
      if (cols === lastSizeRef.current.cols && rows === lastSizeRef.current.rows) return;
      lastSizeRef.current = { cols, rows };
      const id = sessionIdRef.current;
      if (id) void api.resizeTerminal?.({ id, cols, rows }).catch(() => {});
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncSize);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [visible, api]);

  const cwd = phase.state === "running" || phase.state === "exited" ? phase.cwd : "";
  const displayCwd = phase.state === "running" || phase.state === "exited" ? phase.displayCwd : "";
  const statusText =
    phase.state === "connecting"
      ? "Starting…"
      : phase.state === "exited"
        ? phase.signal
          ? `Exited (${phase.signal})`
          : `Exited (${phase.code ?? 0})`
        : phase.state === "error"
          ? phase.message
          : "";

  return (
    <section className="terminal-panel" aria-label={`Terminal for ${label}`}>
      <header className="terminal-header">
        <span className="terminal-cwd" title={cwd || label}>
          {displayCwd || label}
        </span>
        {statusText && (
          <span
            className={`terminal-status${phase.state === "error" ? " is-error" : ""}`}
            role={phase.state === "error" ? "alert" : "status"}
          >
            {statusText}
          </span>
        )}
        {phase.state !== "connecting" && phase.state !== "running" && (
          <button
            type="button"
            className="icon-button terminal-restart"
            aria-label="Restart terminal"
            title="Restart terminal"
            onClick={() => setGeneration((value) => value + 1)}
          >
            <Icon name="renew" />
          </button>
        )}
      </header>
      <div ref={hostRef} className="terminal-viewport" data-terminal-state={phase.state} />
    </section>
  );
}
