// Stable electron-builder 26 configuration. Publication belongs to release.yml.
const release = process.env.CODE60_RELEASE === "1";
const maintainer = process.env.RELEASE_MAINTAINER;
if (release && !/^.+ <[^<>\s]+@[^<>\s]+>$/.test(maintainer || "")) {
  throw new Error("Set RELEASE_MAINTAINER to Name <email> for release packages");
}
if (release && process.platform === "darwin") {
  for (const name of [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
  ]) {
    if (!process.env[name]) throw new Error(`Missing release signing setting: ${name}`);
  }
}
module.exports = {
  appId: "com.codemanufactory.code60",
  productName: "Code60",
  directories: { output: "release/build", buildResources: "packaging" },
  // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder expands these macros.
  artifactName: "Code60-${version}-${os}-${arch}.${ext}",
  asar: true,
  files: [
    "dist/**/*",
    "!**/*.map",
    "!**/{test,tests,__tests__,fixtures,examples}/**/*",
    "package.json",
    "LICENSE",
    "NOTICE",
    "TRADEMARKS.md",
  ],
  extraResources: [{ from: "release/licenses", to: "licenses" }],
  publish: null,
  // The MCP sidecar launches the bundled Electron executable in Node mode.
  electronFuses: { runAsNode: true },
  mac: {
    target: [{ target: "dmg", arch: ["arm64"] }],
    category: "public.app-category.developer-tools",
    icon: "packaging/icon.png",
    hardenedRuntime: release,
    forceCodeSigning: release,
    notarize: release,
    ...(release ? {} : { identity: "-" }),
  },
  dmg: { sign: release },
  linux: {
    // DEB and AppImage map ${arch} to different aliases; use one release filename convention.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder expands these macros.
    artifactName: "Code60-${version}-linux-x64.${ext}",
    syncDesktopName: true,
    target: [
      { target: "deb", arch: ["x64"] },
      { target: "AppImage", arch: ["x64"] },
    ],
    executableName: "code60-desktop",
    // Override the legacy AppImage target's default --no-sandbox argument.
    executableArgs: [],
    category: "Development",
    icon: "packaging/icon.png",
    maintainer: maintainer || "Code60 CI <ci@example.invalid>",
    desktop: { entry: { Name: "Code60", StartupWMClass: "code60-desktop" } },
  },
};
