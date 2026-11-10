import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { machine, release as osRelease, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assetNames, digest, json, run, unsignedWindowsBeta } from "./release/common.mjs";
import { verifyWindowsSignature } from "./verify-windows-signatures.mjs";

const { version } = await json("package.json");
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "code60-install-"));
const test = (executable, dataRoot) =>
  run(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.packaged.config.ts"],
    {
      stdio: "inherit",
      timeout: 8 * 60_000,
      env: {
        ...process.env,
        CODE60_PACKAGED_EXECUTABLE: executable,
        ...(dataRoot ? { CODE60_PACKAGED_DATA_ROOT: dataRoot } : {}),
      },
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
  } else if (process.platform === "win32") {
    const release = process.env.CODE60_RELEASE === "1";
    const unsigned = unsignedWindowsBeta(version);
    const signed = release && !unsigned;
    if (release && (process.arch !== "x64" || machine() !== "x86_64"))
      throw new Error("Release verification requires native Windows x64, not emulation");
    run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `
      $ErrorActionPreference = 'Stop'
      foreach ($root in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
                         'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
        if (Test-Path -LiteralPath $root) {
          foreach ($key in Get-ChildItem -LiteralPath $root) {
            $item = Get-ItemProperty -LiteralPath $key.PSPath
            if ($item.DisplayName -eq 'Code60') { throw 'Use a disposable account without an existing Code60 installation' }
          }
        }
      }
    `,
      ],
      { timeout: 30_000, windowsHide: true },
    );
    const installer = resolve("release/build", assetNames(version, "win")[0]);
    const installation = join(temporary, "Installed Code60");
    const executable = join(installation, "Code60.exe");
    const uninstaller = join(installation, "Uninstall Code60.exe");
    const helper = join(installation, "resources", "native", "code60-host.exe");
    if (signed) verifyWindowsSignature(installer);
    const install = () =>
      run(installer, ["/S", "/currentuser", `/D=${installation}`], {
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: 5 * 60_000,
      });
    const uninstall = () =>
      run(uninstaller, ["/S", "/currentuser", `_?=${installation}`], {
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: 5 * 60_000,
      });
    install();
    let installed = true;
    try {
      if (signed)
        for (const file of [executable, helper, uninstaller]) verifyWindowsSignature(file);
      const retained = join(temporary, "retained user data");
      await mkdir(retained);
      test(executable, retained);
      // These are the real profiles, database, records and worktrees used by the app.
      const files = await fileDigests(retained);
      for (const name of [
        "config.json",
        "desktop.json",
        "code60.sqlite",
        "run.json",
        "installer-marker.txt",
      ])
        if (![...files.keys()].some((file) => file.endsWith(name)))
          throw new Error("Installer persistence fixture did not create all required user data");
      install();
      if (signed)
        for (const file of [executable, helper, uninstaller]) verifyWindowsSignature(file);
      await unchanged(files);
      test(executable, retained);
      uninstall();
      installed = false;
      await unchanged(files);
      if (existsSync(executable))
        throw new Error("Windows uninstall retained the application executable");
      if (release) {
        await mkdir("release", { recursive: true });
        await writeFile(
          "release/windows-verification.json",
          JSON.stringify({
            verified: true,
            installerSha256: await digest(installer),
            version,
            nativeX64: true,
            verifiedOn: { platform: process.platform, release: osRelease(), arch: process.arch },
            signing: signed ? "authenticode" : "unsigned-beta",
            signaturesVerified: signed,
            publisher: signed ? process.env.WIN_SIGNING_PUBLISHER : null,
          }),
        );
      }
    } finally {
      // Do not leave a development installation registered after failed tests.
      if (installed && existsSync(uninstaller)) uninstall();
    }
  } else throw new Error("Installer tests support macOS, Linux and Windows only");
} finally {
  if (mounted) run("/usr/bin/hdiutil", ["detach", join(temporary, "volume")]);
  // Windows can briefly retain an image lock after the uninstaller exits.
  // Retry deletion only inside the temporary fixture created by this script.
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function fileDigests(directory) {
  const result = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Unexpected link in installer test data");
    if (entry.isDirectory()) {
      for (const [file, hash] of await fileDigests(path)) result.set(file, hash);
    } else if (entry.isFile()) result.set(path, await digest(path));
  }
  return result;
}

async function unchanged(files) {
  for (const [file, hash] of files) {
    if ((await digest(file)) !== hash)
      throw new Error("Windows upgrade/uninstall modified user data");
  }
}
