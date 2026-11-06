import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assetNames, json, run } from "./release/common.mjs";

const { version } = await json("package.json");
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "code60-install-"));
const test = (executable) =>
  run(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.packaged.config.ts"],
    {
      stdio: "inherit",
      timeout: 8 * 60_000,
      env: { ...process.env, CODE60_PACKAGED_EXECUTABLE: executable },
    },
  );
let mounted = false;
try {
  if (process.platform === "darwin") {
    const dmg = resolve("release/build", assetNames(version, "mac")[0]);
    const mount = join(temporary, "volume");
    if (process.env.CODE60_RELEASE === "1") {
      run("/usr/bin/codesign", ["--verify", "--strict", dmg]);
      run("/usr/bin/xcrun", ["stapler", "validate", dmg]);
      run("/usr/sbin/spctl", [
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        dmg,
      ]);
    }
    run("/usr/bin/hdiutil", ["attach", dmg, "-nobrowse", "-readonly", "-mountpoint", mount]);
    mounted = true;
    const app = join(temporary, "Code60.app");
    // ditto preserves the signed bundle and extended attributes.
    run("/usr/bin/ditto", [join(mount, "Code60.app"), app]);
    if (process.env.CODE60_RELEASE === "1") {
      run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
      // Gatekeeper verifies the Developer ID and Apple notarization decision.
      run("/usr/bin/xcrun", ["stapler", "validate", app]);
      run("/usr/sbin/spctl", ["--assess", "--type", "execute", app]);
    }
    test(join(app, "Contents", "MacOS", "Code60"));
  } else if (process.platform === "linux") {
    const [debName, imageName] = assetNames(version, "linux");
    run("sudo", ["apt-get", "install", "-y", resolve("release/build", debName)], {
      stdio: "inherit",
      timeout: 5 * 60_000,
    });
    const executable = run("dpkg", ["-L", "code60"])
      .split("\n")
      .find((path) => path.startsWith("/opt/") && path.endsWith("/code60-desktop"));
    if (!executable) throw new Error("Installed DEB executable was not found");
    test(executable);
    const image = join(temporary, imageName);
    await cp(join(root, "release/build", imageName), image);
    const { chmod } = await import("node:fs/promises");
    await chmod(image, 0o755);
    test(image); // Exercise AppRun and FUSE, not an extracted replacement executable.
  } else throw new Error("Installer tests support macOS and Linux only");
} finally {
  if (mounted) run("/usr/bin/hdiutil", ["detach", join(temporary, "volume")]);
  await rm(temporary, { recursive: true, force: true });
}
