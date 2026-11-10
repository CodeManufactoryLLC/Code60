import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BUILTIN_COMMANDS, type Command, type DesktopApi } from "../bridge/index.js";
import {
  CommandComposer,
  CommandMessage,
  invokedCommand,
  matchingCommands,
} from "./command-composer.js";
import { CommandsPage } from "./commands-page.js";

const command: Command = {
  id: "01900000-0000-4000-8000-000000000001",
  name: "review",
  title: "Inspect changes",
  description: "Look for defects",
  prompt: "Review <script> as text.",
  createdAt: "a",
  updatedAt: "a",
};
it("renders labelled fields and actions without treating a saved command's metadata as editable fields", () => {
  const html = renderToStaticMarkup(
    <CommandsPage commands={[command]} api={{} as DesktopApi} onSnapshot={() => {}} />,
  );
  for (const label of [
    "Title",
    "Name",
    "Description",
    "Prompt",
    "Save",
    "Discard changes",
    "Delete",
    "New command",
  ])
    expect(html).toContain(label);
  expect(html).toContain("Review &lt;script&gt; as text.");
  expect(html).toContain('aria-invalid="false"');
  expect(html).not.toContain('aria-invalid="true"');
  expect(html).toMatch(/<h1 class="table-title"[^>]*>Commands<\/h1>/);
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  expect(header).toContain("New command");
  expect(html.indexOf('class="commands-scroll"')).toBeGreaterThan(html.indexOf("</header>"));
});
it("filters suggestions by title and name only while the caret is in the first word", () => {
  expect(matchingCommands([command], "/", 1)).toEqual([command, ...BUILTIN_COMMANDS]);
  expect(matchingCommands([command], "/ins", 4)).toEqual([command]);
  expect(matchingCommands([command], "/REV", 4)).toEqual([command]);
  expect(matchingCommands([command], "/rev rest", 9)).toEqual([]);
  expect(matchingCommands([command], " /rev", 4)).toEqual([]);
  expect(invokedCommand([command], "/review extra")).toEqual(command);
  expect(invokedCommand([command], "/rev")).toBeUndefined();
});
it("offers and recognizes the built-in create-command with no saved commands", () => {
  expect(matchingCommands([], "/create", 7)).toEqual(
    BUILTIN_COMMANDS.filter((entry) => entry.name === "create-command"),
  );
  expect(invokedCommand([], "/create-command Review SQL migrations")).toEqual(BUILTIN_COMMANDS[0]);
  expect(
    renderToStaticMarkup(
      <CommandMessage commands={[]} text="/create-command Review SQL migrations" />,
    ),
  ).toBe('<mark class="command-label">/create-command</mark> Review SQL migrations');
  const html = renderToStaticMarkup(
    <CommandComposer
      id="builtin"
      commands={[]}
      value="/create-command Make a reviewer"
      disabled={false}
      onChange={() => {}}
      onSend={() => {}}
    />,
  );
  expect(html).not.toContain("will be sent as plain text");
});
it.each(["plan", "business-evaluation"])("offers /%s without a saved command", (name) => {
  const builtin = BUILTIN_COMMANDS.find((entry) => entry.name === name);
  expect(builtin).toBeDefined();
  expect(matchingCommands([], `/${name}`, name.length + 1)).toEqual([builtin]);
  expect(invokedCommand([], `/${name} My request`)).toEqual(builtin);
  const override = { ...command, name };
  expect(matchingCommands([override], `/${name}`, name.length + 1)).toEqual([override]);
  expect(renderToStaticMarkup(<CommandMessage commands={[]} text={`/${name} My request`} />)).toBe(
    `<mark class="command-label">/${name}</mark> My request`,
  );
});
it("shows the plain-text fallback and marks only a recognized leading command", () => {
  const html = renderToStaticMarkup(
    <CommandComposer
      id="message"
      commands={[command]}
      value="/tmp is full"
      disabled={false}
      onChange={() => {}}
      onSend={() => {}}
    />,
  );
  expect(html).toContain('role="combobox"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("will be sent as plain text");
  expect(renderToStaticMarkup(<CommandMessage commands={[command]} text="/review  extra" />)).toBe(
    '<mark class="command-label">/review</mark>  extra',
  );
  expect(renderToStaticMarkup(<CommandMessage commands={[command]} text="Use /review" />)).toBe(
    "Use /review",
  );
});
