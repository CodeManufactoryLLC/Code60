import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ApplicationClient } from "../bridge/index.js";
import { AgentEditor, CustomAgentsPage } from "./custom-agents.js";

it("keeps agent creation available without a database and renders user names as text", () => {
  const html = renderToStaticMarkup(
    <CustomAgentsPage
      api={{} as ApplicationClient}
      active
      agents={[{ id: "a", revision: 1, archived: false, name: "<script>name</script>" }]}
      onOpen={async () => true}
    />,
  );
  expect(html).toContain("New Assistant");
  expect(html).toContain("Custom Assistants");
  expect(html).toContain("&lt;script&gt;name&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain('aria-label="Custom Assistants actions"');
  expect(html).not.toContain(">Archived</button>");
  expect(html).toContain('aria-haspopup="menu" aria-expanded="false"');
  expect(html).toMatch(/class="[^"]*home-card-actions[^"]*cds--btn/);
  expect(html).not.toContain('class="custom-agent-actions"');
  expect(html).not.toContain('aria-label="Edit ');
  expect(html).not.toContain('aria-label="Archive ');
  expect(html).not.toContain("disabled");
});

it("keeps editor field labels independent of saved instruction text", () => {
  const html = renderToStaticMarkup(
    <AgentEditor
      api={{} as ApplicationClient}
      agent={{
        id: "a",
        revision: 1,
        archived: false,
        name: "Reviewer",
        instructions: "Act as Reviewer.",
      }}
      onClose={() => {}}
    />,
  );
  const nameId = /<label[^>]*for="([^"]+)"[^>]*>Name<\/label>/.exec(html)?.[1];
  const instructionsId = /<label[^>]*for="([^"]+)"[^>]*>Special instructions<\/label>/.exec(
    html,
  )?.[1];
  expect(nameId).toBeTruthy();
  expect(instructionsId).toBeTruthy();
  expect(html).toMatch(new RegExp(`<input[^>]*id="${nameId}"`));
  expect(html).toMatch(new RegExp(`<textarea[^>]*id="${instructionsId}"`));
  expect(html).toContain(">Act as Reviewer.</textarea>");
});
