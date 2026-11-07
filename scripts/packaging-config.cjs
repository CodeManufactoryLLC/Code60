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
if (release && process.platform === "win32") {
  for (const name of ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD", "WIN_SIGNING_THUMBPRINT"]) {
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
  extraResources: [
    { from: "release/licenses", to: "licenses" },
    ...(process.platform === "win32"
      ? [
          {
            // Directory copies run electron-builder's executable signing transformer.
            // A single-file extraResource bypasses that transformer.
            from: "native/win32/x64",
            to: "native",
            filter: ["code60-host.exe"],
          },
        ]
      : []),
  ],
  publish: {
    provider: "github",
    owner: "CodeManufactoryLLC",
    repo: "code60",
    channel: require("../package.json").version.split("-")[1]?.split(".")[0] || "latest",
  },
  // The MCP sidecar launches the bundled Electron executable in Node mode.
  electronFuses: { runAsNode: true },
  mac: {
    target: [
      { target: "dmg", arch: ["arm64"] },
      { target: "zip", arch: ["arm64"] },
    ],
    category: "public.app-category.developer-tools",
    icon: "packaging/icon.png",
    hardenedRuntime: release,
    forceCodeSigning: release,
    notarize: release,
    ...(release ? {} : { identity: "-" }),
  },
  dmg: { sign: release },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    executableName: "Code60",
    forceCodeSigning: release,
    signAndEditExecutable: true,
    signtoolOptions: {
      signingHashAlgorithms: ["sha256"],
      rfc3161TimeStampServer: "https://timestamp.digicert.com",
    },
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: false,
  },
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
