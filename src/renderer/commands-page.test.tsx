import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { type ApplicationClient, BUILTIN_COMMANDS, type Command } from "../bridge/index.js";
import { CommandMessage, commandSuggestions, invokedCommand } from "./command-composer.js";
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
    <CommandsPage commands={[command]} api={{} as ApplicationClient} onSnapshot={() => {}} />,
  );
  for (const label of [
    "Title",
    "Name",
    "Description",
    "Prompt",
    "Save",
    "Discard changes",
    "Delete",
  ])
    expect(html).toContain(label);
  expect(html).toContain("Review &lt;script&gt; as text.");
  expect(html).toContain('class="prompt-editor-name">$review</span>');
  expect(html).toContain("Use $name at the start of a message.");
  expect(html).toContain("with $name to use one.");
  expect(html).not.toContain('aria-invalid="true"');
  expect(html).toMatch(/<h1[^>]*class="content-page-title"[^>]*>.*Commands<\/span>.*<\/h1>/);
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  expect(html).toContain(">New command</button>");
  expect(header).not.toContain("New command");
  expect(html.indexOf('class="commands-scroll"')).toBeGreaterThan(html.indexOf("</header>"));
});
it("offers canonical tokens for Carbon suggestions and preserves typed arguments", () => {
  expect(commandSuggestions([command])[0]).toEqual({
    id: command.id,
    label: "review",
    value: "$review",
    description: "Inspect changes",
  });
  expect(invokedCommand([command], "$review extra")).toEqual(command);
  expect(invokedCommand([command], "$rev")).toBeUndefined();
});
it("offers and recognizes the built-in create-command with no saved commands", () => {
  expect(invokedCommand([], "$create-command Review SQL migrations")).toEqual(BUILTIN_COMMANDS[0]);
  expect(
    renderToStaticMarkup(
      <CommandMessage commands={[]} text="$create-command Review SQL migrations" />,
    ),
  ).toBe('<mark class="command-label">$create-command</mark> Review SQL migrations');
});
it.each(["plan", "business-evaluation", "catch-me-up", "big-picture", "pushback", "simplify"])(
  "offers $%s without a saved command",
  (name) => {
    const builtin = BUILTIN_COMMANDS.find((entry) => entry.name === name);
    expect(builtin).toBeDefined();
    expect(commandSuggestions([])).toContainEqual(expect.objectContaining({ value: `$${name}` }));
    expect(invokedCommand([], `$${name} My request`)).toEqual(builtin);
    const override = { ...command, name };
    expect(commandSuggestions([override]).filter((item) => item.value === `$${name}`)).toHaveLength(
      1,
    );
    expect(
      renderToStaticMarkup(<CommandMessage commands={[]} text={`$${name} My request`} />),
    ).toBe(`<mark class="command-label">$${name}</mark> My request`);
  },
);
it("shows the plain-text fallback and marks only a recognized leading command", () => {
  expect(renderToStaticMarkup(<CommandMessage commands={[command]} text="$review  extra" />)).toBe(
    '<mark class="command-label">$review</mark>  extra',
  );
  expect(renderToStaticMarkup(<CommandMessage commands={[command]} text="Use $review" />)).toBe(
    "Use $review",
  );
});

it.each(["/review", "/plan", "/tmp is full"])("leaves %s as ordinary text", (text) => {
  expect(invokedCommand([command], text)).toBeUndefined();
  expect(renderToStaticMarkup(<CommandMessage commands={[command]} text={text} />)).toBe(text);
});
