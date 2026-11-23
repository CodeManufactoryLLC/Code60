import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplicationClient, WebServerCode, WebServerStatus } from "../bridge/index.js";
import { copyText } from "./browser-platform.js";
import { PageTitle } from "./page-title.js";

export function WebServerPage({ api, visible }: { api: ApplicationClient; visible: boolean }) {
  const [status, setStatus] = useState<WebServerStatus | null>(null);
  const [code, setCode] = useState<WebServerCode | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const revision = useRef(0);
  const inFlight = useRef(false);
  const lastStatus = useRef<WebServerStatus | null>(null);
  const applyStatus = useCallback((next: WebServerStatus) => {
    if (lastStatus.current?.url !== next.url || !next.enabled || !next.canManage) setCode(null);
    lastStatus.current = next;
    setStatus(next);
  }, []);
  useEffect(() => {
    setCode(null);
    const current = ++generation.current;
    if (!visible || !api.webServerStatus) return;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (inFlight.current) {
        timer = setTimeout(() => void poll(), 1_000);
        return;
      }
      const observed = revision.current;
      try {
        const next = await api.webServerStatus?.();
        if (generation.current !== current || !next) return;
        if (revision.current !== observed) {
          if (generation.current === current) timer = setTimeout(() => void poll(), 1_000);
          return;
        }
        applyStatus(next);
        setNow(Date.now());
      } catch {
        if (generation.current === current)
          setError("Could not read Web Server Beta status. Retry.");
      }
      if (generation.current === current) timer = setTimeout(() => void poll(), 1_000);
    };
    void poll();
    return () => {
      generation.current++;
      clearTimeout(timer);
    };
  }, [api, visible, applyStatus]);
  useEffect(() => {
    if (code && code.expiresAt <= now) setCode(null);
  }, [code, now]);
  const newCode = async () => {
    if (!api.createWebServerCode) throw new Error("LAN pairing is unavailable.");
    const current = generation.current;
    const next = await api.createWebServerCode();
    if (generation.current === current) {
      setCode(next);
      setNow(Date.now());
    }
  };
  const action = async (perform: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    try {
      await perform();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Web Server Beta could not be changed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const change = (enabled: boolean) =>
    action(async () => {
      if (!api.setWebServerEnabled) throw new Error("Web Server Beta is unavailable.");
      setCode(null);
      const current = generation.current;
      const next = await api.setWebServerEnabled({ enabled });
      if (generation.current !== current) return;
      applyStatus(next);
      if (next.enabled && next.state === "listening") await newCode();
    });
  return (
    <main className="web-server-page" aria-label="Web Server Beta">
      <PageTitle page="web-server" />
      <section className="settings-group web-server-controls" aria-label="LAN access">
        <label className="settings-row">
          Enable Web Server Beta
          <input
            type="checkbox"
            role="switch"
            checked={status?.enabled ?? false}
            aria-checked={status?.enabled ?? false}
            disabled={busy || !status?.canManage}
            onChange={(event) => void change(event.target.checked)}
          />
        </label>
        <p role="status">
          {!status
            ? "Loading…"
            : {
                disabled: "Off",
                starting: "Starting…",
                listening: "Listening",
                stopping: "Stopping…",
                unavailable: "Unavailable",
              }[status.state]}
        </p>
        {status?.url && (
          <a href={status.url} target="_blank" rel="noopener noreferrer">
            {status.url}
          </a>
        )}
        {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
        {status?.canManage && status.state === "unavailable" && (
          <button type="button" disabled={busy} onClick={() => void change(true)}>
            Retry
          </button>
        )}
        {status?.state === "listening" && status.canManage && (
          <div className="web-server-pairing">
            {code && (
              <>
                <output aria-label="LAN pairing code">{code.code}</output>
                <span>
                  Expires in {Math.max(0, Math.ceil((code.expiresAt - now) / 1000))} seconds
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void action(() => copyText(code.code))}
                >
                  Copy code
                </button>
              </>
            )}
            <button type="button" disabled={busy} onClick={() => void action(newCode)}>
              {code ? "New code" : "Generate pairing code"}
            </button>
          </div>
        )}
        {status && !status.canManage && (
          <p>Manage access from the controlling localhost browser.</p>
        )}
      </section>
      <section className="web-server-help" aria-label="Help">
        <h2>Help</h2>
        <p>
          Open the LAN address on another device and enter the pairing code. Use Take control to
          operate Code60 from that browser.
        </p>
        <p>
          Use a trusted network. HTTP traffic is not encrypted. File choosers show files on the
          computer running Code60.
        </p>
      </section>
    </main>
  );
}
