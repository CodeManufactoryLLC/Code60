import { useRef } from "react";
import type { WorkflowDraft } from "../bridge/index.js";
import { randomId } from "./browser-platform.js";
import { Button as AppButton } from "./carbon/button.js";
import { TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Textarea as CarbonTextArea } from "./carbon/textarea.js";

export type WorkflowTaskDraft = WorkflowDraft["tasks"][number];

export const emptyWorkflowTask = (): WorkflowTaskDraft => ({
  name: "",
  instructions: "",
  verify: "",
  checks: [],
});

/** Shared ordered task list editor used by both Workflows and Scheduled Jobs. */
export function WorkflowTaskEditor({
  tasks,
  disabled = false,
  onChange,
}: {
  tasks: readonly WorkflowTaskDraft[];
  disabled?: boolean;
  onChange(next: WorkflowTaskDraft[]): void;
}) {
  const keys = useRef<string[]>(Array.from({ length: tasks.length }, () => randomId()));
  while (keys.current.length < tasks.length) keys.current.push(randomId());
  if (keys.current.length > tasks.length) keys.current.length = tasks.length;

  const updateTask = (index: number, patch: Partial<WorkflowTaskDraft>) =>
    onChange(tasks.map((task, i) => (i === index ? { ...task, ...patch } : task)));

  return (
    <>
      <ol className="workflow-task-editor">
        {tasks.map((task, index) => (
          <li key={keys.current[index]}>
            <div>
              <CarbonTextInput
                labelText={<>Task name</>}
                value={task.name}
                maxLength={160}
                disabled={disabled}
                onChange={(event) => updateTask(index, { name: event.target.value })}
              />
            </div>
            <div>
              <CarbonTextArea
                labelText={<>Implementation instructions</>}
                value={task.instructions}
                maxLength={65_536}
                disabled={disabled}
                onChange={(event) => updateTask(index, { instructions: event.target.value })}
              />
            </div>
            <div>
              <CarbonTextArea
                labelText={<>Verification criteria</>}
                value={task.verify}
                maxLength={65_536}
                disabled={disabled}
                onChange={(event) => updateTask(index, { verify: event.target.value })}
              />
            </div>
            <div>
              <CarbonTextArea
                labelText={<>Check commands (one per line)</>}
                value={task.checks?.join("\n") ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  updateTask(index, { checks: event.target.value.split("\n").filter(Boolean) })
                }
              />
            </div>
            <div className="workflow-actions">
              <AppButton
                type="button"
                disabled={disabled || index === 0}
                onClick={() => {
                  const next = [...tasks];
                  const current = next[index];
                  const previous = next[index - 1];
                  const key = keys.current[index];
                  const previousKey = keys.current[index - 1];
                  if (!current || !previous || !key || !previousKey) return;
                  [next[index - 1], next[index]] = [current, previous];
                  [keys.current[index - 1], keys.current[index]] = [key, previousKey];
                  onChange(next);
                }}
              >
                Move up
              </AppButton>
              <AppButton
                type="button"
                disabled={disabled}
                onClick={() => {
                  keys.current.splice(index, 1);
                  onChange(tasks.filter((_, i) => i !== index));
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
        disabled={disabled || tasks.length >= 100}
        onClick={() => {
          keys.current.push(randomId());
          onChange([...tasks, emptyWorkflowTask()]);
        }}
      >
        Add task
      </AppButton>
    </>
  );
}
