import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const styleNonce = randomBytes(24).toString("base64");

export default defineConfig({
  html: { cspNonce: styleNonce },
  plugins: [
    {
      name: "monaco-csp-styles",
      transformIndexHtml(html) {
        return html.replace("style-src 'self'", `style-src 'self' 'nonce-${styleNonce}'`);
      },
      transform(code, id) {
        if (!id.includes("monaco-editor/esm/") || !id.endsWith(".js")) return;
        return code.replaceAll(
          "document.createElement('style')",
          `(Object.assign(document.createElement('style'), { nonce: ${JSON.stringify(styleNonce)} }))`,
        );
      },
    },
  ],
  root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./dist/renderer", import.meta.url)),
    emptyOutDir: true,
    // The Content Security Policy allows fonts and images only from the app, not data: URLs.
    assetsInlineLimit: 0,
  },
});
