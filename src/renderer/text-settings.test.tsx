import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TextSettings } from "./text-settings.js";
import { parseTextStyles } from "./typography.js";

it("offers browser-default sizing and retains an existing custom reading size", () => {
  const html = renderToStaticMarkup(
    <TextSettings
      textStyles={parseTextStyles('{"normalText":{"size":23},"pageTitles":{"weight":700}}')}
      onTextStyles={() => {}}
    />,
  );
  expect(html).toContain("Interface text size");
  expect(html).toContain('value="23" selected=""');
  expect(html.match(/<select/g)).toHaveLength(1);
});
