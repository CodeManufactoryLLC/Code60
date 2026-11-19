import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { build } from "vite";
import { expect, it } from "vitest";

it("compiles prefixed card utilities with live aliases and no reset or unrelated utilities", async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [tailwindcss()],
    root: fileURLToPath(new URL("../src/renderer", import.meta.url)),
    build: {
      write: false,
      cssMinify: false,
      rollupOptions: {
        input: fileURLToPath(new URL("../src/renderer/neobrutalism/theme.css", import.meta.url)),
      },
    },
  });
  if (Array.isArray(result) || !("output" in result)) throw new Error("Expected CSS build output");
  const css = result.output
    .flatMap((entry) =>
      entry.type === "asset" && entry.fileName.endsWith(".css") ? [String(entry.source)] : [],
    )
    .join("\n");
  expect(css).toContain(".nb\\:border-2");
  expect(css).toContain("border-width: 2px");
  expect(css).toContain("border-color: var(--panel-border)");
  expect(css).toContain("background-color: var(--surface)");
  expect(css).toContain("var(--card-shadow)");
  expect(css).toContain("border-radius: var(--navigation-card-radius)");
  expect(css).toContain("--nb-card-spacing: 16px");
  expect(css).not.toMatch(/--card-spacing\s*:/);
  expect(css).not.toMatch(
    /(?:^|[\s}])(?:body|button|h1|\.flex|\.grid|\.rounded|\.home-card)\s*[{,]/,
  );
  expect(css).not.toContain("button, input");
  expect(css).not.toContain(".nb\\:text-center"); // Exists elsewhere in the renderer, outside explicit sources.
  expect(css).toContain("@layer neobrutalism");
});
