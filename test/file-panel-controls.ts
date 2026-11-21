import { expect, type Page } from "@playwright/test";

export async function openFileViews(page: Page) {
  const selector = page.getByRole("combobox", { name: "Files view", exact: true });
  await expect(selector).toBeEnabled();
  if ((await selector.getAttribute("aria-expanded")) !== "true") await selector.click();
  const list = page.getByRole("listbox", { name: "Open Files tabs", exact: true });
  await expect(list).toBeVisible();
  return list;
}

export async function selectFileView(page: Page, label: string, index = 0) {
  const list = await openFileViews(page);
  await list.getByRole("option", { name: label, exact: true }).nth(index).click();
  await expect(page.getByRole("combobox", { name: "Files view", exact: true })).toBeFocused();
}

export async function fileViewLabels(page: Page) {
  const selector = page.getByRole("combobox", { name: "Files view", exact: true });
  await expect(selector).toBeVisible();
  if (await selector.isDisabled()) return [];
  const list = await openFileViews(page);
  // Main-page destinations and New Tab are available actions, not stored tabs.
  const labels = await list
    .getByRole("option")
    .evaluateAll((options) =>
      options.filter((option) => /-\d+$/.test(option.id)).map((option) => option.textContent ?? ""),
    );
  await list.press("Escape");
  await expect(list).toBeHidden();
  return labels.map((label) => label.trim()).filter((label) => label !== "+ New Tab");
}

export async function newFileTab(page: Page) {
  await selectFileView(page, "+ New Tab");
}
