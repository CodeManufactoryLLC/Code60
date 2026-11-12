import { useLayoutEffect, useRef, useState } from "react";
import { availableCommands, type Command, leadingCommand } from "../bridge/index.js";

export function matchingCommands(commands: readonly Command[], text: string, cursor: number) {
  const token = /^\/([^\s]*)/.exec(text);
  if (!token || cursor < 1 || cursor > token[0].length) return [];
  const query = (token[1] ?? "").toLowerCase();
  return availableCommands(commands).filter(
    (entry) => entry.name.includes(query) || entry.title.toLowerCase().includes(query),
  );
}
export function invokedCommand(commands: readonly Command[], text: string) {
  const name = leadingCommand(text);
  return availableCommands(commands).find((entry) => entry.name === name);
}

export function CommandComposer({
  id,
  value,
  commands,
  commandsEnabled = true,
  disabled,
  onChange,
  onSend,
}: {
  id: string;
  value: string;
  commands: readonly Command[];
  commandsEnabled?: boolean;
  disabled: boolean;
  onChange(text: string): void;
  onSend(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const inserted = useRef<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState(0);
  const matches = commandsEnabled ? matchingCommands(commands, value, cursor) : [];
  const open = focused && !disabled && !dismissed && matches.length > 0;
  const index = Math.min(selected, matches.length - 1);
  const listId = `${id}-commands`;
  const unknown = commandsEnabled && /^\/\S+/.test(value) && !invokedCommand(commands, value);
  function insert(command: Command) {
    const rest = value.replace(/^\/\S*\s?/, "");
    const prefix = `/${command.name} `;
    onChange(prefix + rest);
    setDismissed(true);
    setCursor(prefix.length);
    inserted.current = prefix + rest;
  }
  // Place the caret in the same commit as the inserted value; a later frame could undo input
  // the user typed or selected in the meantime.
  useLayoutEffect(() => {
    const element = input.current;
    const text = inserted.current;
    if (!element || text === null || value !== text) return;
    inserted.current = null;
    const end = text.length - text.replace(/^\/\S*\s?/, "").length;
    element.focus();
    element.setSelectionRange(end, end);
  }, [value]);
  return (
    <>
      {open && (
        <div className="command-picker">
          <div role="listbox" id={listId} aria-label="Commands">
            {matches.map((command, position) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                key={command.id}
                id={`${listId}-${command.id}`}
                aria-selected={position === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(command)}
              >
                <span>/{command.name}</span>
                <span>{command.title}</span>
                {command.description && <small>{command.description}</small>}
              </button>
            ))}
          </div>
          <p className="muted">Up/Down to choose, Enter or Tab to insert, Escape to close.</p>
        </div>
      )}
      <textarea
        ref={input}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && matches[index] ? `${listId}-${matches[index].id}` : undefined
        }
        aria-describedby={unknown ? `${id}-plain-text` : undefined}
        placeholder={commandsEnabled ? "Message… (type / for commands)" : "Message…"}
        rows={2}
        value={value}
        disabled={disabled}
        maxLength={1_000_000}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
        onChange={(event) => {
          onChange(event.target.value);
          setCursor(event.target.selectionStart);
          setSelected(0);
          setDismissed(false);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          // Selection events can arrive after input, so read the caret directly rather than
          // risk sending an unexpanded command from a stale closed picker.
          const element = event.currentTarget;
          const matches = matchingCommands(commands, element.value, element.selectionStart);
          const index = Math.min(selected, matches.length - 1);
          if (element.selectionStart !== cursor) setCursor(element.selectionStart);
          if (!disabled && !dismissed && matches.length > 0) {
            if (event.key === "Escape") {
              event.preventDefault();
              setDismissed(true);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next =
                (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
              setSelected(next);
              document
                .getElementById(`${listId}-${matches[next]?.id}`)
                ?.scrollIntoView({ block: "nearest" });
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              const command = matches[index];
              if (command) insert(command);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSend();
          }
        }}
      />
      {unknown && (
        <p className="command-plain-text muted" id={`${id}-plain-text`}>
          No matching command. This message will be sent as plain text.
        </p>
      )}
    </>
  );
}

export function CommandMessage({ text, commands }: { text: string; commands: readonly Command[] }) {
  if (!invokedCommand(commands, text)) return text;
  const token = /^\/\S+/.exec(text)?.[0] ?? "";
  return (
    <>
      <mark className="command-label">{token}</mark>
      {text.slice(token.length)}
    </>
  );
}
