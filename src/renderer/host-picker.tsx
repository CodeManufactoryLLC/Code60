import { Button } from "@carbon/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import type { BrowserSession, Choices, Interaction } from "../bridge/index.js";
import { browserRequest } from "./browser-client.js";
import { Button as AppButton } from "./carbon/button.js";
import { TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";

type Visit = { directory?: string | undefined; index?: number; createDirectory?: string };
type Listing = { choices: Choices; history: (string | undefined)[]; index: number };
const validName = (name: string) =>
  !!name.trim() &&
  name !== "." &&
  name !== ".." &&
  !/[/\\]/.test(name) &&
  ![...name].some((c) => (c.codePointAt(0) ?? 0) < 32);

export default function HostPicker({
  session,
  interaction,
  busy,
  error,
  answer,
}: {
  session: BrowserSession;
  interaction: Interaction;
  busy: boolean;
  error: string;
  answer(accepted: boolean, choice?: string, filename?: string): Promise<void>;
}) {
  const [listing, setListing] = useState<Listing>();
  const [selected, select] = useState<string>();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [filename, setFilename] = useState("code60.sqlite");
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ message: string; visit: Visit }>();
  const [showAnswerError, setShowAnswerError] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const formInput = useRef<HTMLInputElement>(null);
  const newFolder = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const touch = useRef(false);

  const load = useCallback(
    async (visit: Visit) => {
      if (pending.current) return;
      pending.current = true;
      const token = ++generation.current;
      setLoading(true);
      setFailure(undefined);
      setShowAnswerError(false);
      try {
        const choices = await browserRequest<Choices>("/api/chooser", session, {
          id: interaction.id,
          directory: visit.directory,
          createDirectory: visit.createDirectory,
        });
        if (generation.current !== token) return;
        const id = choices.entries.find((entry) => entry.name === ".")?.id;
        setListing((previous) => {
          if (previous && visit.index !== undefined)
            return { choices, history: previous.history, index: visit.index };
          const history = previous ? previous.history.slice(0, previous.index + 1) : [];
          history.push(id);
          return { choices, history, index: history.length - 1 };
        });
        select(undefined);
        setFolderName(null);
      } catch (cause) {
        if (generation.current === token)
          setFailure({
            message: cause instanceof Error ? cause.message : "Could not list this folder.",
            visit,
          });
      } finally {
        if (generation.current === token) {
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [interaction.id, session],
  );
  useEffect(() => {
    void load({});
    return () => {
      generation.current++;
      pending.current = false;
    };
  }, [load]);
  useLayoutEffect(() => {
    if (listing) listRef.current?.focus();
  }, [listing]);
  const editing = folderName !== null;
  useEffect(() => {
    if (editing) formInput.current?.focus();
  }, [editing]);

  const choices = listing?.choices;
  const entries = choices?.entries ?? [];
  const current = entries.find((entry) => entry.name === ".");
  const parent = entries.find((entry) => entry.name === "..");
  const items = entries.filter((entry) => entry.name !== "." && entry.name !== "..");
  const item = items.find((entry) => entry.id === selected);
  const creating = interaction.picker === "database-create";
  const folder = interaction.picker === "folder";
  let target = item?.directory ? undefined : item;
  if (folder) target = item ?? current;
  if (creating) target = validName(filename) ? current : undefined;
  const locked = loading || busy;
  const submit = async (accepted: boolean, id?: string) => {
    if (pending.current || locked) return;
    pending.current = true;
    setShowAnswerError(true);
    try {
      await answer(accepted, id, creating && accepted ? filename : undefined);
    } finally {
      pending.current = false;
    }
  };
  const confirmChoice = () => {
    if (!editing && target) void submit(true, target.id);
  };
  const travel = (index: number) => void load({ index, directory: listing?.history[index] });
  const closeEditor = () => {
    setFolderName(null);
    setFailure(undefined);
    newFolder.current?.focus();
  };
  return (
    <Modal
      title={interaction.title}
      className="host-picker"
      busy={locked}
      onClose={() => void submit(false)}
      footer={
        <>
          <Button kind="secondary" disabled={locked} onClick={() => void submit(false)}>
            Cancel
          </Button>
          <Button kind="primary" disabled={locked || !target || editing} onClick={confirmChoice}>
            {creating ? "Create database" : folder ? "Choose folder" : "Open"}
          </Button>
        </>
      }
    >
      <div className="picker-path">
        <span className="cds--label">Location</span>
        <div className="picker-location">
          <bdi>{choices?.directory ?? "Workspace roots"}</bdi>
        </div>
      </div>
      <nav className="picker-navigation" aria-label="Folder navigation">
        <div className="picker-directions">
          <AppButton
            type="button"
            className="icon-button"
            aria-label="Back"
            title="Back"
            disabled={locked || !listing?.index}
            onClick={() => listing && travel(listing.index - 1)}
          >
            <Icon name="arrow--left" />
          </AppButton>
          <AppButton
            type="button"
            className="icon-button"
            aria-label="Forward"
            title="Forward"
            disabled={locked || !listing || listing.index >= listing.history.length - 1}
            onClick={() => listing && travel(listing.index + 1)}
          >
            <Icon name="arrow--right" />
          </AppButton>
          <AppButton
            type="button"
            className="icon-button"
            aria-label="Up"
            title="Up"
            disabled={locked || !current}
            onClick={() => void load({ directory: parent?.id })}
          >
            <Icon name="arrow--up" />
          </AppButton>
        </div>
        <div className="picker-tools">
          <Button
            kind="ghost"
            size="sm"
            disabled={locked || !item?.directory}
            onClick={() => item?.directory && void load({ directory: item.id })}
          >
            Open folder
          </Button>
          <Button
            kind="ghost"
            size="sm"
            ref={newFolder}
            disabled={locked || !current}
            onClick={() => setFolderName("")}
          >
            New folder
          </Button>
        </div>
      </nav>
      {folderName !== null && (
        <form
          className="picker-name-form"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !locked) {
              event.preventDefault();
              event.stopPropagation();
              closeEditor();
            }
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (current && validName(folderName))
              void load({ directory: current.id, createDirectory: folderName });
          }}
        >
          <div>
            <CarbonTextInput
              labelText="New folder name"
              ref={formInput}
              maxLength={200}
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
            />
          </div>
          <div className="picker-tools">
            <Button type="button" kind="ghost" size="sm" disabled={locked} onClick={closeEditor}>
              Dismiss
            </Button>
            <Button
              kind="tertiary"
              size="sm"
              type="submit"
              disabled={locked || !validName(folderName)}
            >
              Create folder
            </Button>
          </div>
        </form>
      )}
      <div
        className="picker-contents"
        onPointerDownCapture={(e) => {
          touch.current = e.pointerType === "touch" || e.pointerType === "pen";
        }}
        onKeyDownCapture={() => {
          touch.current = false;
        }}
      >
        <ListBox
          ref={listRef}
          aria-label="Folders and databases"
          items={items}
          selectionMode="single"
          selectionBehavior="replace"
          selectedKeys={selected ? [selected] : []}
          disallowEmptySelection
          escapeKeyBehavior="none"
          onSelectionChange={(keys) => {
            if (!locked && keys !== "all") select(keys.values().next().value?.toString());
          }}
          onAction={(id) => {
            const entry = items.find((option) => option.id === id);
            if (!entry || locked) return;
            if (touch.current) select(entry.id);
            else if (entry.directory) void load({ directory: entry.id });
            else void submit(true, entry.id);
          }}
          renderEmptyState={() =>
            loading ? "Loading folders…" : failure ? null : "No items in this location."
          }
        >
          {(entry) => (
            <ListBoxItem
              id={entry.id}
              textValue={entry.name}
              aria-label={entry.name}
              className="picker-row"
            >
              <Icon name={entry.directory ? "folder" : "document"} />
              <span className="file-entry-name" title={entry.name}>
                {entry.name}
              </span>
            </ListBoxItem>
          )}
        </ListBox>
      </div>
      {loading && choices && <p role="status">Loading folders…</p>}
      {choices?.truncated && <p role="status">Folder listing limit reached.</p>}
      {failure && (
        <div className="picker-error" role="alert">
          {failure.message}{" "}
          {!failure.visit.createDirectory && (
            <AppButton type="button" disabled={locked} onClick={() => void load(failure.visit)}>
              Retry
            </AppButton>
          )}
        </div>
      )}
      {showAnswerError && error && (
        <p role="alert" className="picker-error">
          {error}
        </p>
      )}
      {creating && (
        <form
          className="picker-filename"
          onSubmit={(event) => {
            event.preventDefault();
            confirmChoice();
          }}
        >
          <CarbonTextInput
            labelText="Database filename"
            value={filename}
            maxLength={200}
            onChange={(event) => setFilename(event.target.value)}
          />
        </form>
      )}
    </Modal>
  );
}
