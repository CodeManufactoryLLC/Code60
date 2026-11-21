import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

/** Native text areas retain Tab navigation; the mirrored gutter follows wrapped source lines. */
export function PromptTextInput({
  id,
  label,
  value,
  busy,
  wrap,
  lines,
  invalid,
  problemId,
  input,
  onChange,
  onFocus,
  onUndo,
}: {
  id: string;
  label: string;
  value: string;
  busy: boolean;
  wrap: boolean;
  lines: boolean;
  invalid: boolean;
  problemId: string;
  input?: RefObject<HTMLTextAreaElement | null>;
  onChange(value: string): void;
  onFocus(input: HTMLTextAreaElement): void;
  onUndo(redo: boolean): void;
}) {
  const local = useRef<HTMLTextAreaElement>(null);
  const area = input ?? local;
  const gutter = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = area.current;
    if (!element || !lines) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [area, lines]);
  return (
    <>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="prompt-editor-input" data-invalid={invalid || undefined} data-lines={lines}>
        {lines && (
          <div className="prompt-line-gutter" aria-hidden="true" ref={gutter}>
            <div style={{ width, whiteSpace: wrap ? "pre-wrap" : "pre" }}>
              {value.split("\n").map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Stateless source-line gutters are identified by line position.
                <div className="prompt-line-mirror" key={index}>
                  <span>{index + 1}</span>
                  {line || " "}
                </div>
              ))}
            </div>
          </div>
        )}
        <textarea
          id={id}
          ref={area}
          value={value}
          disabled={busy}
          spellCheck={false}
          wrap={wrap ? "soft" : "off"}
          aria-invalid={invalid}
          aria-describedby={invalid ? problemId : undefined}
          onFocus={(event) => onFocus(event.currentTarget)}
          onScroll={(event) => {
            if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
            ) {
              event.preventDefault();
              onUndo(event.shiftKey || event.key.toLowerCase() === "y");
            }
          }}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </>
  );
}
