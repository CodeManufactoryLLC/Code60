import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DesktopApi } from "../bridge/index.js";
import { CustomAgentsPage } from "./custom-agents.js";

it("keeps agent creation available without a database and renders user names as text", () => {
  const html = renderToStaticMarkup(
    <CustomAgentsPage
      api={{} as DesktopApi}
      active
      agents={[{ id: "a", revision: 1, archived: false, name: "<script>name</script>" }]}
      onOpen={async () => true}
    />,
  );
  expect(html).toContain("New Agent");
  expect(html).toContain("Custom Agents");
  expect(html).toContain("&lt;script&gt;name&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Archived");
  expect(html).not.toContain("disabled");
});
