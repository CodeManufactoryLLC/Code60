import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import type { Browser } from "@playwright/test";

/** Synthetic renderer fixtures only; never serves user paths or the product gateway. */
export async function fixturePage(browser: Browser, directory: string) {
  const assets = new Map<string, string>();
  for (const item of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (item.isFile()) {
      const path = join(item.parentPath, item.name);
      assets.set(path.slice(directory.length), path);
    }
  }
  const server = createServer((request, response) => {
    const path = assets.get(request.url === "/" ? "/index.html" : (request.url ?? ""));
    if (!path) {
      response.writeHead(404);
      response.end();
      return;
    }
    const type =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
      }[extname(path)] ?? "application/octet-stream";
    void readFile(path).then(
      (bytes) => {
        response.writeHead(200, { "Content-Type": type });
        response.end(bytes);
      },
      () => {
        response.writeHead(500);
        response.end();
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind.");
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`);
  return {
    page,
    async close() {
      await context.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
