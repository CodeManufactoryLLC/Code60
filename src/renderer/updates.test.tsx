import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ApplicationClient } from "../bridge/index.js";
import { UpdatesSection, useUpdates } from "./updates.js";

it("shows installed version and terminal instructions without browser update authority", async () => {
  const api = new Proxy(
    {},
    {
      get() {
        throw Error("Updates attempted an application request");
      },
    },
  ) as ApplicationClient;
  const updates = useUpdates(api, "0.5.0");
  const html = renderToStaticMarkup(<UpdatesSection updates={updates} />);
  expect(html).toContain("Installed version: 0.5.0");
  expect(html).toContain("code60 update");
  expect(html).toContain("code60 update recover");
  expect(html).not.toContain("Install the new Code60 npm package");
  await expect(updates.act("check")).rejects.toThrow("terminal");
  expect(updates.state.autoCheck).toBe(false);
  expect(renderToStaticMarkup(<UpdatesSection updates={useUpdates(api)} />)).toContain(
    "Unavailable",
  );
});
