import { z } from "zod";
import { BUSINESS_EVALUATION_PROMPT } from "./business-evaluation.js";

z.config({ jitless: true });

export const COMMAND_LIMIT = 200;
export const commandNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}(?![\s\S])/, "Use 1–64 lowercase letters, digits or hyphens");

export const commandFieldsSchema = z.strictObject({
  name: commandNameSchema,
  title: z
    .string()
    .max(120, "Use at most 120 characters")
    .refine(
      (text) =>
        text.trim().length > 0 &&
        [...text].every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 && code !== 127 && code !== 0x2028 && code !== 0x2029;
        }),
      "Use a nonempty, single-line title",
    ),
  description: z.string().max(500, "Use at most 500 characters").default(""),
  prompt: z
    .string()
    .max(100_000, "Use at most 100,000 characters")
    .refine((text) => text.trim().length > 0, "Enter a prompt"),
});
export const saveCommandSchema = commandFieldsSchema.extend({ id: z.string().uuid().optional() });
export const deleteCommandSchema = z.strictObject({ id: z.string().uuid() });
export const commandSchema = commandFieldsSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Command = z.infer<typeof commandSchema>;
export type SaveCommand = z.input<typeof saveCommandSchema>;
export type DeleteCommand = z.infer<typeof deleteCommandSchema>;

/** Built-ins are bundled prompts, not saved database rows or executable tools. */
export const BUILTIN_COMMANDS: readonly Command[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "create-command",
    title: "Create a command",
    description: "Create a reusable $ command from your instructions.",
    prompt: [
      "Create a reusable Code60 $ command from the user's additional instructions below.",
      "Use code60_create_command to save it in the connected database. Do not delegate this to a worker or write a skill file.",
      "Infer a concise lowercase, hyphenated name, a clear single-line title, a short description, and a self-contained reusable prompt that preserves the user's intent.",
      "Honor any name, title, description, or prompt the user explicitly provides. Ask a focused question if the instructions are missing or essential details are unclear; do not save a placeholder command.",
      "Create the command only, without carrying out its prompt. Do not overwrite an existing command. If saving fails, explain the error instead of claiming success.",
      "After the tool confirms creation, tell the user the saved $name and show a short invocation example.",
    ].join("\n"),
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "plan",
    title: "Make a plan",
    description: "Propose a plan for your request and wait for Code60 acceptance.",
    prompt: [
      "Make a concrete, ordered plan for the user's request using the additional instructions below and the supplied conversation context.",
      "If the request is missing and cannot be found in context, ask one essential question instead of inventing a task.",
      "Use only minimal permitted read-only inspection needed to understand the request or locate an existing draft. Do not begin implementation, substantive research, worker dispatch, or project edits before plan acceptance.",
      "Use code60_create_plan to save the plan and open it for human review, providing a title, description, ordered tasks, and a unique requestId. Reuse requestId only for an identical retry.",
      "Make the plan specific to the request. Include scope, dependencies, unresolved assumptions, deliverables, validation, and clear completion criteria. Respect the host application's permissions and operating rules.",
      "If revising an existing draft, read its latest revision and revise that same plan with code60_update_plan rather than creating another draft.",
      "After creating or revising the plan, briefly say it is ready for review, then end your turn and wait for the user to select Accept in Code60.",
      "Do not treat a chat expression of approval as acceptance. No tool can accept a plan. Begin execution only after Code60 delivers the accepted plan; acceptance grants only the displayed scope under the host rules.",
      "If planning is unavailable or fails, report the blocker without substituting a conversational outline or starting the work.",
    ].join("\n"),
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "business-evaluation",
    title: "Business evaluation",
    description: "Plan an evidence-based business evaluation, then wait for Code60 acceptance.",
    prompt: BUSINESS_EVALUATION_PROMPT,
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    name: "catch-me-up",
    title: "Catch me up",
    description: "Explain the broader context and anything I may have missed.",
    prompt: [
      "Give the user broader context for what you are currently discussing, using the conversation and any additional instructions below.",
      "Explain the overall goal, how the current topic fits into it, and why it matters. Cover relevant background, terms, decisions, progress and unresolved questions the user may have missed; do not assume they followed every step.",
      "Distinguish established facts from assumptions and proposals. Be clear about missing context rather than inventing earlier events or decisions.",
      "Use a concise, self-contained explanation and end with where things stand and the next meaningful decision or step. This request is for an explanation, not additional implementation.",
    ].join("\n"),
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    name: "big-picture",
    title: "Reassess the big picture",
    description: "Step back from the details and reassess the value and approach.",
    prompt: [
      "The user is signaling that you are going down a rabbit hole. Pause the current line of investigation and step back, using the conversation and any additional instructions below.",
      "Restate the user's actual goal and what a useful outcome would be. Assess whether the current work materially advances that goal, whether its effort is justified, and which assumptions or details are distracting from it.",
      "Re-evaluate the approach, including simpler alternatives and whether to continue, change direction or stop this line of work. Recommend the smallest useful next step and explain its value and tradeoffs.",
      "Respond with the reassessment before resuming work. Do not treat this command as approval to expand scope or change an accepted plan.",
    ].join("\n"),
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    name: "pushback",
    title: "Recheck the evidence",
    description: "Challenge your conclusion and re-evaluate the evidence.",
    prompt: [
      "The user believes your current claim, conclusion or approach is wrong. Take that challenge seriously and re-evaluate it using the conversation and any additional instructions below.",
      "Identify the disputed claim, revisit the underlying evidence, and check for unsupported assumptions, contradictions, missing context and plausible alternative explanations. Seek the strongest evidence against your current position rather than defending it reflexively.",
      "Verify material disputed facts with available sources or tools when needed. Separate direct evidence, inference and uncertainty; do not claim to have checked evidence you cannot access.",
      "Correct any error plainly and explain what changed and why. If the evidence still supports some or all of your original conclusion, explain that respectfully with specific support and acknowledge remaining uncertainty; do not agree merely to appease the user.",
      "Give the revised assessment before continuing dependent work. This command requests reassessment, not unrelated edits or expanded scope.",
    ].join("\n"),
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000007",
    name: "simplify",
    title: "Explain it simply",
    description: "Explain the current topic in simple, plain language.",
    prompt: [
      "Explain the current topic or your previous response in simple, plain language, using the conversation and any additional instructions below.",
      "Lead with the main point. Use familiar words and short, connected sentences. Remove jargon, acronyms and unnecessary detail; briefly explain any technical term that is essential.",
      "Use a concrete example or analogy if it makes the idea easier to understand. Preserve the meaning, important caveats and uncertainty without talking down to the user.",
      "Provide the simpler explanation directly. This is a request to simplify your explanation, not to refactor code, change files or alter the task's scope.",
    ].join("\n"),
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
  },
];

/** Keep saved commands first and preserve existing user commands with a built-in name. */
export function availableCommands(commands: readonly Command[]): Command[] {
  return [
    ...commands,
    ...BUILTIN_COMMANDS.filter(
      (builtin) => !commands.some((entry) => entry.name.toLowerCase() === builtin.name),
    ),
  ];
}

/** Only a complete token at the very beginning can invoke a command. */
export function leadingCommand(text: string): string | undefined {
  return /^\$([a-z0-9][a-z0-9-]{0,63})(?=\s|$)/i.exec(text)?.[1]?.toLowerCase();
}

export function expandCommand(command: Command, text: string): string {
  if (leadingCommand(text) !== command.name.toLowerCase())
    throw new Error("The command must match the beginning of the message");
  const rest = text.slice((/^\$\S+/.exec(text)?.[0] ?? "").length).trim();
  return `Command $${command.name}: ${command.title}\n${command.prompt}${
    rest ? `\n\nAdditional instructions:\n${rest}` : ""
  }`;
}
