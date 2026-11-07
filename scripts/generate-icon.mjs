// Render a full-bleed viridian desktop icon with the wordmark's chamfer and font.
// Run with Node after npm ci; Electron supplies Chromium without extra dependencies.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

if (!process.versions.electron) {
  const { default: electron } = await import("electron");
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NODE_OPTIONS;
  execFileSync(electron, [fileURLToPath(import.meta.url)], {
    cwd: fileURLToPath(root),
    env: environment,
    stdio: "inherit",
    timeout: 30_000,
  });
} else {
  const { app, BrowserWindow } = await import("electron");
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
  app
    .whenReady()
    .then(async () => {
      const [styles, font] = await Promise.all([
        readFile(new URL("src/renderer/style.css", root), "utf8"),
        readFile(new URL("src/renderer/fonts/d-din/D-DIN.woff2", root)),
      ]);
      const window = new BrowserWindow({
        width: 1024,
        height: 1024,
        useContentSize: true,
        show: false,
        frame: false,
        backgroundColor: "#000000",
        webPreferences: {
          offscreen: true,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: "code60-icon",
        },
      });
      const html = `<!doctype html>
<html data-theme="light"><head><meta charset="utf-8"><style>
@font-face {
  font-family: "D-DIN";
  font-weight: 400;
  src: url(data:font/woff2;base64,${font.toString("base64")}) format("woff2");
}
${styles}
html, body { margin: 0; width: 1024px; height: 1024px; background: #000000; }
.wordmark { display: block; width: 100%; height: 100%; font-size: 576px; line-height: 1; }
.wordmark b {
  /* Extend the desktop cut past macOS's rounded icon mask. */
  --wordmark-chamfer: 352px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  background: #40826d;
  color: #000000;
}
</style></head><body><span class="wordmark"><b>60</b></span></body></html>`;
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await window.webContents.executeJavaScript(`
      document.fonts.ready.then(() => {
        if (!document.fonts.check('400 576px "D-DIN"'))
          throw new Error("The icon font did not load");
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })
    `);
      const image = await window.webContents.capturePage();
      const { width, height } = image.getSize();
      if (width !== 1024 || height !== 1024) throw new Error("Expected a 1024px desktop icon");
      await writeFile(new URL("packaging/icon.png", root), image.toPNG());
      window.destroy();
      app.quit();
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
