import { useEffect, useRef, useState } from "react";
import {
  type ApplicationClient,
  type WorkflowDraft,
  type WorkflowDraftReply,
  type WorkflowRecord,
  type WorkflowRepository,
  type WorkflowReview,
  workflowDraftReplySchema,
} from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import { Button as AppButton } from "./carbon/button.js";
import { Checkbox as CarbonCheckbox } from "./carbon/choices.js";
import { TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Textarea as CarbonTextArea } from "./carbon/textarea.js";
import { ChatTurn, EmbeddedChat } from "./embedded-chat.js";
import { Modal } from "./modal.js";

type Message = { id: string; role: "user" | "assistant"; text: string };
const emptyTask = () => ({ name: "", instructions: "", verify: "", checks: [] as string[] });
export function WorkflowForm({
  api,
  initialDefinition,
  providerReady,
  active,
  onProvider,
  onCreated,
  onClose,
}: {
  api: ApplicationClient;
  initialDefinition?: WorkflowRecord["definition"] | undefined;
  providerReady: boolean;
  active: boolean;
  onProvider(): void;
  onCreated(record: WorkflowRecord): void;
  onClose(): void;
}) {
  const [formId] = useState(() => randomId());
  const revision = useRef(0);
  const [initialKeys] = useState(() =>
    Array.from({ length: initialDefinition?.tasks.length ?? 1 }, () => randomId()),
  );
  const taskKeys = useRef(initialKeys);
  const alive = useRef(true);
  const generation = useRef<string | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft>(() => ({
    name: "",
    repositoryToken: randomId(),
    tasks: [emptyTask()],
    repairs: 2,
    retries: 2,
    autoApprove: true,
    ...structuredClone(initialDefinition),
  }));
  const [repository, setRepository] = useState<WorkflowRepository | null>(null);
  const [review, setReview] = useState<WorkflowReview | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const generate = async (text: string) => {
    if (generation.current || !providerReady || !text.trim() || text.length > 16_000) return false;
    const requestId = randomId();
    const ticket = revision.current;
    const conversation = [...messages, { id: randomId(), role: "user" as const, text }].slice(-20);
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
      if (!alive.current || generation.current !== requestId || revision.current !== ticket)
        return false;
      setMessages(
        [
          ...conversation,
          { id: randomId(), role: "assistant" as const, text: result.message },
        ].slice(-20),
      );
      if (result.draft) {
        taskKeys.current = result.draft.tasks.map(() => randomId());
        change({ ...draft, ...result.draft });
      }
      return true;
    } catch (cause) {
      if (alive.current && generation.current === requestId) {
        setMessages(messages);
        setPrompt((current) => current || text);
        setError(cause instanceof Error ? cause.message : "Could not create workflow draft");
      }
      return false;
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
        <AppButton type="button" disabled={busy} onClick={() => setChat(true)}>
          Create with prompt
        </AppButton>
        <AppButton type="button" disabled={busy} onClick={onClose}>
          Close form
        </AppButton>
      </div>
      <fieldset disabled={busy}>
        <div>
          <CarbonTextInput
            labelText={<>Workflow name</>}
            value={draft.name}
            maxLength={160}
            onChange={(event) => change({ ...draft, name: event.target.value })}
          />
        </div>
        <div className="workflow-actions">
          <AppButton
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
          </AppButton>
          <span>{repository?.label ?? "No repository selected"}</span>
        </div>
        <ol className="workflow-task-editor">
          {draft.tasks.map((task, index) => (
            <li key={taskKeys.current[index]}>
              <div>
                <CarbonTextInput
                  labelText={<>Task name</>}
                  value={task.name}
                  maxLength={65_536}
                  onChange={(event) => taskChange(index, { name: event.target.value })}
                />
              </div>
              <div>
                <CarbonTextArea
                  labelText={<>Implementation instructions</>}
                  value={task.instructions}
                  maxLength={65_536}
                  onChange={(event) => taskChange(index, { instructions: event.target.value })}
                />
              </div>
              <div>
                <CarbonTextArea
                  labelText={<>Verification criteria</>}
                  value={task.verify}
                  maxLength={65_536}
                  onChange={(event) => taskChange(index, { verify: event.target.value })}
                />
              </div>
              <div>
                <CarbonTextArea
                  labelText={<>Check commands (one per line)</>}
                  value={task.checks?.join("\n") ?? ""}
                  onChange={(event) =>
                    taskChange(index, { checks: event.target.value.split("\n").filter(Boolean) })
                  }
                />
              </div>
              <div className="workflow-actions">
                <AppButton
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
                </AppButton>
                <AppButton
                  type="button"
                  onClick={() => {
                    taskKeys.current.splice(index, 1);
                    change({ ...draft, tasks: draft.tasks.filter((_, i) => i !== index) });
                  }}
                >
                  Remove task
                </AppButton>
              </div>
            </li>
          ))}
        </ol>
        <AppButton
          type="button"
          disabled={draft.tasks.length >= 100}
          onClick={() => {
            taskKeys.current.push(randomId());
            change({ ...draft, tasks: [...draft.tasks, emptyTask()] });
          }}
        >
          Add task
        </AppButton>
        <div className="workflow-actions">
          <div>
            <CarbonTextInput
              labelText={<>Repairs per worker</>}
              type="number"
              min={0}
              max={30}
              value={draft.repairs}
              onChange={(event) => change({ ...draft, repairs: Number(event.target.value) })}
            />
          </div>
          <div>
            <CarbonTextInput
              labelText={<>Fresh-session retries</>}
              type="number"
              min={0}
              max={30}
              value={draft.retries}
              onChange={(event) => change({ ...draft, retries: Number(event.target.value) })}
            />
          </div>
        </div>
        <div className="workflow-check">
          <CarbonCheckbox
            labelText={<>Automatically approve harness permissions</>}
            checked={draft.autoApprove}
            onChange={(event) => change({ ...draft, autoApprove: event.target.checked })}
          />
        </div>
        <AppButton
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
        </AppButton>
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
            <dt>Workflow provider</dt>
            <dd>
              Use <code>code60 workflows login</code> in a terminal if Codex authentication is
              needed. Code60 provider connections are separate.
            </dd>
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
          <AppButton
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
          </AppButton>
        </section>
      )}
      {error && !chat && <p role="alert">{error}</p>}
      {chat && active && (
        <Modal
          footer={
            !providerReady && (
              <AppButton
                variant="primary"
                type="button"
                onClick={() => {
                  closeChat();
                  onProvider();
                }}
              >
                Connect a provider
              </AppButton>
            )
          }
          title="Create with prompt"
          busy={false}
          onClose={closeChat}
          closeLabel="Close chat"
        >
          {error && <p role="alert">{error}</p>}
          {providerReady && (
            <div className="workflow-draft-chat">
              <EmbeddedChat
                active
                label="Describe the workflow"
                draft={prompt}
                onEdit={setPrompt}
                onSend={generate}
                canSend={!generating}
                disabled={false}
                focus
                limit={16_000}
                stop={generating ? cancelDraft : undefined}
              >
                {messages.map((message) => (
                  <ChatTurn key={message.id} from={message.role}>
                    <p>{message.text}</p>
                  </ChatTurn>
                ))}
              </EmbeddedChat>
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
