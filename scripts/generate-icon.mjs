import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  await page.goto(new URL("../packaging/icon.svg", import.meta.url).href);
  await page.screenshot({
    path: fileURLToPath(new URL("../packaging/icon.png", import.meta.url)),
    omitBackground: true,
  });
} finally {
  await browser.close();
}
