import { expect, type Page } from "@playwright/test";

/** Open the current owner's command menu through its visible header trigger. */
export async function pageCommand(page: Page, name: string | RegExp) {
  const trigger = page
    .locator(".content-page-heading:visible")
    .getByRole("button", { name: / actions$/ });
  await expect(trigger).toHaveCount(1);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const id = await trigger.getAttribute("aria-controls");
  if (!id) throw new Error("Missing page action menu ID");
  const menu = page.locator(`[role="menu"][id="${id}"]`);
  await expect(menu).toBeVisible();
  return menu
    .getByRole("menuitem", { name, exact: typeof name === "string" })
    .or(menu.getByRole("menuitemcheckbox", { name, exact: typeof name === "string" }));
}
