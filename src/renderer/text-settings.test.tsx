import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TextSettings } from "./text-settings.js";
import { defaultTextStyles, parseTextStyles } from "./typography.js";

it("offers seven independent text roles with role-specific defaults and Light weights", () => {
  const html = renderToStaticMarkup(
    <TextSettings textStyles={defaultTextStyles} onTextStyles={() => {}} />,
  );
  const groups = html.match(/<fieldset[\s\S]*?<\/fieldset>/g) ?? [];
  expect(groups).toHaveLength(7);
  for (const group of groups) {
    expect(group).toContain('<option value="300">Light</option>');
    expect(group).toContain(
      group.includes(">Page Titles</legend>") ? "Default (Medium)" : "Default (Light)",
    );
    expect(group).toContain('type="number" min="8" max="64"');
  }
  const page = groups.find((group) => group.includes(">Page Titles</legend>"));
  expect(page).toContain("Default (IBM Plex Sans)");
  expect(page).toContain("Default (Medium)");
  expect(page).toContain('placeholder="16"');
  expect(page).toContain("font-family:&quot;IBM Plex Sans&quot;");
  expect(page).toContain("font-size:16px;font-weight:500");
  const card = groups.find((group) => group.includes(">Card Titles</legend>"));
  expect(card).toContain("Default (IBM Plex Sans)");
  expect(card).toContain("Default (Light)");
  expect(card).toContain('placeholder="22"');
  expect(card).not.toContain("Reset Card Titles");
});

it("keeps saved card-title and page-title choices and their reset actions independent", () => {
  const html = renderToStaticMarkup(
    <TextSettings
      textStyles={parseTextStyles(
        '{"pageTitles":{"typeface":"georgia","size":32},"cardTitles":{"typeface":"ibm-plex-sans","weight":300}}',
      )}
      onTextStyles={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Reset Page Titles"');
  expect(html).toContain('aria-label="Reset Card Titles"');
  expect(html).toContain('<option value="300" selected="">Light</option>');
});
