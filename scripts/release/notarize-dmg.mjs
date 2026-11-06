import { join } from "node:path";
import { assetNames, json, run } from "./common.mjs";
import { staple } from "./staple.mjs";

if (process.env.CODE60_RELEASE !== "1") throw new Error("Notarization is a release-only operation");
for (const key of ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const { version } = await json("package.json");
const dmg = join("release/build", assetNames(version, "mac")[0]);
const result = JSON.parse(
  run(
    "/usr/bin/xcrun",
    [
      "notarytool",
      "submit",
      dmg,
      "--key",
      process.env.APPLE_API_KEY,
      "--key-id",
      process.env.APPLE_API_KEY_ID,
      "--issuer",
      process.env.APPLE_API_ISSUER,
      "--wait",
      "--timeout",
      "20m",
      "--output-format",
      "json",
    ],
    { timeout: 21 * 60_000 },
  ),
);
if (result.status !== "Accepted") throw new Error(`DMG notarization failed: ${result.status}`);
await staple(dmg);
run("/usr/bin/xcrun", ["stapler", "validate", dmg]);
run("/usr/bin/codesign", ["--verify", "--strict", dmg]);
