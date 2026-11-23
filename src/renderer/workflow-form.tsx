import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type ApplicationClient,
  type WorkflowDraft,
  type WorkflowDraftReply,
  type WorkflowRecord,
  type WorkflowRepository,
  type WorkflowReview,
  workflowDraftReplySchema,
} from "../bridge/index.js";
import { DialogContent } from "./neobrutalism/dialog.js";

type Message = { id: string; role: "user" | "assistant"; text: string };
const emptyTask = () => ({ name: "", instructions: "", verify: "", checks: [] as string[] });
export function WorkflowForm({
  api,
  providerReady,
  active,
  onProvider,
  onCreated,
  onClose,
}: {
  api: ApplicationClient;
  providerReady: boolean;
  active: boolean;
  onProvider(): void;
  onCreated(record: WorkflowRecord): void;
  onClose(): void;
}) {
  const [formId] = useState(() => crypto.randomUUID());
  const revision = useRef(0);
  const taskKeys = useRef<string[]>([crypto.randomUUID()]);
  const alive = useRef(true);
  const generation = useRef<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>({
    name: "",
    repositoryToken: crypto.randomUUID(),
    tasks: [emptyTask()],
    repairs: 2,
    retries: 2,
    autoApprove: true,
  });
  const [repository, setRepository] = useState<WorkflowRepository | null>(null);
  const [review, setReview] = useState<WorkflowReview | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelDraft = () => {
    const requestId = generation.current;
    generation.current = null;
    setGenerating(false);
    void api
      .workflow({ action: "cancelDraft", formId, ...(requestId ? { requestId } : {}) })
      .catch(() => {});
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current = null;
      void api.workflow({ action: "disposeForm", formId }).catch(() => {});
    };
  }, [api, formId]);
  useEffect(() => {
    if (!active || !providerReady) {
      generation.current = null;
      setGenerating(false);
      void api.workflow({ action: "cancelDraft", formId }).catch(() => {});
    }
  }, [active, providerReady, api, formId]);
  useLayoutEffect(() => {
    if (chat && active) dialog.current?.showModal();
    else dialog.current?.close();
  }, [chat, active]);
  const change = (next: WorkflowDraft) => {
    revision.current++;
    setDraft(next);
    setReview(null);
    generation.current = null;
    setGenerating(false);
    void api.workflow({ action: "invalidate", formId, revision: revision.current }).catch(() => {});
  };
  const taskChange = (index: number, update: Partial<WorkflowDraft["tasks"][number]>) =>
    change({
      ...draft,
      tasks: draft.tasks.map((task, i) => (i === index ? { ...task, ...update } : task)),
    });
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Workflow action failed");
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const generate = async () => {
    if (generating || !prompt.trim()) return;
    const requestId = crypto.randomUUID();
    const ticket = revision.current;
    const conversation = [
      ...messages,
      { id: crypto.randomUUID(), role: "user" as const, text: prompt },
    ].slice(-20);
    setMessages(conversation);
    setPrompt("");
    setError("");
    setGenerating(true);
    generation.current = requestId;
    try {
      const result = workflowDraftReplySchema.parse(
        await api.workflow({
          action: "draft",
          formId,
          revision: ticket,
          requestId,
          ...(repository ? { repositoryToken: repository.token } : {}),
          fields: { name: draft.name, tasks: draft.tasks },
          messages: conversation.map(({ role, text }) => ({ role, text })),
        }),
      ) as WorkflowDraftReply;
      if (!alive.current || generation.current !== requestId || revision.current !== ticket) return;
      setMessages(
        [
          ...conversation,
          { id: crypto.randomUUID(), role: "assistant" as const, text: result.message },
        ].slice(-20),
      );
      if (result.draft) {
        taskKeys.current = result.draft.tasks.map(() => crypto.randomUUID());
        change({ ...draft, ...result.draft });
      }
    } catch (cause) {
      if (alive.current && generation.current === requestId)
        setError(cause instanceof Error ? cause.message : "Could not create workflow draft");
    } finally {
      if (alive.current && generation.current === requestId) {
        setGenerating(false);
        generation.current = null;
      }
    }
  };
  const closeChat = () => {
    cancelDraft();
    setChat(false);
  };
  return (
    <section className="workflow-form" aria-label="New workflow">
      <div className="workflow-actions">
        <h2>New workflow</h2>
        <button type="button" disabled={busy} onClick={() => setChat(true)}>
          Create with prompt
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Close form
        </button>
      </div>
      <fieldset disabled={busy}>
        <label>
          Workflow name
          <input
            value={draft.name}
            maxLength={160}
            onChange={(event) => change({ ...draft, name: event.target.value })}
          />
        </label>
        <div className="workflow-actions">
          <button
            type="button"
            onClick={() =>
              void perform(async () => {
                cancelDraft();
                const choice = (await api.workflow({
                  action: "pickRepository",
                  formId,
                })) as WorkflowRepository | null;
                if (alive.current && choice) {
                  setRepository(choice);
                  change({ ...draft, repositoryToken: choice.token });
                }
              })
            }
          >
            Choose repository
          </button>
          <span>{repository?.label ?? "No repository selected"}</span>
        </div>
        <ol className="workflow-task-editor">
          {draft.tasks.map((task, index) => (
            <li key={taskKeys.current[index]}>
              <label>
                Task name
                <input
                  value={task.name}
                  maxLength={65_536}
                  onChange={(event) => taskChange(index, { name: event.target.value })}
                />
              </label>
              <label>
                Implementation instructions
                <textarea
                  value={task.instructions}
                  maxLength={65_536}
                  onChange={(event) => taskChange(index, { instructions: event.target.value })}
                />
              </label>
              <label>
                Verification criteria
                <textarea
                  value={task.verify}
                  maxLength={65_536}
                  onChange={(event) => taskChange(index, { verify: event.target.value })}
                />
              </label>
              <label>
                Check commands (one per line)
                <textarea
                  value={task.checks?.join("\n") ?? ""}
                  onChange={(event) =>
                    taskChange(index, { checks: event.target.value.split("\n").filter(Boolean) })
                  }
                />
              </label>
              <div className="workflow-actions">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => {
                    const tasks = [...draft.tasks];
                    const current = tasks[index];
                    const previous = tasks[index - 1];
                    const key = taskKeys.current[index];
                    const previousKey = taskKeys.current[index - 1];
                    if (!current || !previous || !key || !previousKey) return;
                    [tasks[index - 1], tasks[index]] = [current, previous];
                    [taskKeys.current[index - 1], taskKeys.current[index]] = [key, previousKey];
                    change({ ...draft, tasks });
                  }}
                >
                  Move up
                </button>
                <button
                  type="button"
                  onClick={() => {
                    taskKeys.current.splice(index, 1);
                    change({ ...draft, tasks: draft.tasks.filter((_, i) => i !== index) });
                  }}
                >
                  Remove task
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          disabled={draft.tasks.length >= 100}
          onClick={() => {
            taskKeys.current.push(crypto.randomUUID());
            change({ ...draft, tasks: [...draft.tasks, emptyTask()] });
          }}
        >
          Add task
        </button>
        <div className="workflow-actions">
          <label>
            Repairs per worker
            <input
              type="number"
              min={0}
              max={30}
              value={draft.repairs}
              onChange={(event) => change({ ...draft, repairs: Number(event.target.value) })}
            />
          </label>
          <label>
            Fresh-session retries
            <input
              type="number"
              min={0}
              max={30}
              value={draft.retries}
              onChange={(event) => change({ ...draft, retries: Number(event.target.value) })}
            />
          </label>
        </div>
        <label className="workflow-check">
          <input
            type="checkbox"
            checked={draft.autoApprove}
            onChange={(event) => change({ ...draft, autoApprove: event.target.checked })}
          />
          Automatically approve harness permissions
        </label>
        <button
          type="button"
          disabled={!repository}
          onClick={() =>
            void perform(async () => {
              const ticket = revision.current;
              const next = (await api.workflow({
                action: "review",
                formId,
                revision: ticket,
                draft,
              })) as WorkflowReview;
              if (alive.current && revision.current === ticket) setReview(next);
            })
          }
        >
          Review workflow
        </button>
      </fieldset>
      {review && (
        <section aria-label="Workflow approval" className="workflow-review">
          <h3>{review.draft.name}</h3>
          <dl>
            <dt>Repository</dt>
            <dd>{review.repository}</dd>
            <dt>Baseline</dt>
            <dd>Current saved files</dd>
            <dt>Execution</dt>
            <dd>Dedicated worktree; continues after Code60 quits</dd>
            <dt>Automatic permission approvals</dt>
            <dd>{review.draft.autoApprove ? "Enabled" : "Disabled"}</dd>
            <dt>Repairs / retries</dt>
            <dd>
              {review.draft.repairs} / {review.draft.retries}
            </dd>
          </dl>
          <ol>
            {review.draft.tasks.map((task, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Reviewed task indices are immutable and task names may repeat.
              <li key={`${formId}-review-${index}`}>
                <strong>{task.name}</strong>
                <pre>{task.instructions}</pre>
                <pre>{task.verify}</pre>
                <pre>{task.checks?.join("\n")}</pre>
              </li>
            ))}
          </ol>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const record = (await api.workflow({
                  action: "start",
                  formId,
                  revision: revision.current,
                  approvalId: review.approvalId,
                })) as WorkflowRecord;
                if (alive.current) onCreated(record);
              })
            }
          >
            {busy ? "Starting…" : "Start workflow"}
          </button>
        </section>
      )}
      {error && !chat && <p role="alert">{error}</p>}
      <DialogContent
        ref={dialog}
        aria-labelledby={`${formId}-chat-title`}
        onCancel={(event) => {
          event.preventDefault();
          closeChat();
        }}
      >
        <div className="workflow-actions">
          <h2 id={`${formId}-chat-title`}>Create with prompt</h2>
          <button type="button" onClick={closeChat}>
            Close chat
          </button>
        </div>
        <div className="workflow-draft-chat" role="log" aria-live="polite">
          {messages.map((message) => (
            <div key={message.id}>
              <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
              <p>{message.text}</p>
            </div>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        {!providerReady ? (
          <button
            type="button"
            onClick={() => {
              closeChat();
              onProvider();
            }}
          >
            Connect a provider
          </button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
          >
            <label>
              Describe the workflow
              <textarea
                value={prompt}
                maxLength={16_000}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <div className="workflow-actions">
              <button type="submit" disabled={generating || !prompt.trim()}>
                {generating ? "Drafting…" : "Send"}
              </button>
              {generating && (
                <button type="button" onClick={cancelDraft}>
                  Cancel generation
                </button>
              )}
            </div>
          </form>
        )}
        {error && !chat && <p role="alert">{error}</p>}
      </DialogContent>
    </section>
  );
}
