import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const styleNonce = randomBytes(24).toString("base64");

export default defineConfig(({ command }) => ({
  // The dev fixture shares node_modules with the checkout. Each source tree needs its own optimized modules.
  cacheDir: fileURLToPath(new URL("./test-results/dev/vite-cache", import.meta.url)),
  html: { cspNonce: styleNonce },
  plugins: [
    react(),
    {
      name: "monaco-csp-styles",
      transformIndexHtml(html) {
        if (command === "serve") {
          html = html.replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:*");
          html = html.replace("script-src 'self'", `script-src 'self' 'nonce-${styleNonce}'`);
        }
        return html.replace("style-src 'self'", `style-src 'self' 'nonce-${styleNonce}'`);
      },
      transform(code, id) {
        if (id.includes("monaco-editor/esm/") && id.endsWith(".js")) {
          return code.replaceAll(
            "document.createElement('style')",
            `(Object.assign(document.createElement('style'), { nonce: ${JSON.stringify(styleNonce)} }))`,
          );
        }
        if ((id.includes("@xterm/xterm") || id.includes("@xterm_xterm")) && /\.[cm]?js/.test(id)) {
          return code.replace(
            /([A-Za-z0-9_$.]+)\.createElement\((["'])style\2\)/g,
            `(Object.assign($1.createElement($2style$2), { nonce: ${JSON.stringify(styleNonce)} }))`,
          );
        }
      },
    },
  ],
  root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
  server: {
    hmr: {
      host: "127.0.0.1",
      ...(process.env.CODE60_VITE_PORT ? { clientPort: Number(process.env.CODE60_VITE_PORT) } : {}),
    },
  },
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("./dist/renderer", import.meta.url)),
    emptyOutDir: true,
    // The Content Security Policy allows fonts and images only from the app, not data: URLs.
    assetsInlineLimit: 0,
  },
}));
