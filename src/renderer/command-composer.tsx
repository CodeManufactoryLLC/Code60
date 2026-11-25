import { availableCommands, type Command, leadingCommand } from "../bridge/index.js";
/** Carbon inserts the canonical command token, leaving subsequent arguments editable. */
export function commandSuggestions(commands: readonly Command[]) {
  return availableCommands(commands).map(({ id, name, title }) => ({
    id,
    label: name,
    value: `$${name}`,
    description: title,
  }));
}

export function invokedCommand(commands: readonly Command[], text: string) {
  const name = leadingCommand(text);
  return availableCommands(commands).find((entry) => entry.name === name);
}

export function CommandMessage({ text, commands }: { text: string; commands: readonly Command[] }) {
  if (!invokedCommand(commands, text)) return text;
  const token = /^\$\S+/.exec(text)?.[0] ?? "";
  return (
    <>
      <mark className="command-label">{token}</mark>
      {text.slice(token.length)}
    </>
  );
}
