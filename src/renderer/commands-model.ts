import { type Command, commandFieldsSchema, type SaveCommand } from "../bridge/index.js";

export type CommandFields = Pick<Command, "name" | "title" | "description" | "prompt">;
export interface CommandDraft {
  fields: CommandFields;
  nameEdited: boolean;
}
export const emptyCommand = (): CommandDraft => ({
  fields: { name: "", title: "", description: "", prompt: "" },
  nameEdited: false,
});
export function editCommand(
  draft: CommandDraft,
  field: keyof CommandFields,
  value: string,
): CommandDraft {
  const fields = { ...draft.fields, [field]: value };
  if (field === "title" && !draft.nameEdited)
    fields.name = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
  return { fields, nameEdited: draft.nameEdited || field === "name" };
}
export function commandProblems(fields: CommandFields, commands: readonly Command[], id?: string) {
  const problems: Partial<Record<keyof CommandFields, string>> = {};
  const result = commandFieldsSchema.safeParse(fields);
  if (!result.success)
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof CommandFields;
      problems[field] ??= issue.message;
    }
  if (
    commands.some(
      (entry) => entry.id !== id && entry.name.toLowerCase() === fields.name.toLowerCase(),
    )
  )
    problems.name = "A command with that name already exists";
  return problems;
}
export function commandRequest(fields: CommandFields, id?: string): SaveCommand {
  return { ...fields, ...(id ? { id } : {}) };
}
