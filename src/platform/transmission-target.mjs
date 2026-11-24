export const macEngines = {
  "0.1.0-staging.18": {
    name: "transmission-18",
    integrity:
      "sha512-U1SLG4FZv7yYW9eMzKEVSNx6tZ85YRbGyagEfcBzedfEQkn8Qaj1SS+duXST+8WH4jFaF8XZAbp+tTTiGbhDVg==",
  },
  "0.1.0-staging.20": {
    name: "transmission-20",
    integrity:
      "sha512-23Y6om57UMB1pCAe+XcbH84JzFk0xo6CHJHiCfd06G5E1m1OAxY/JDI9UR43dfACAJfpWQHN+Wm67U4Lc+Xy9Q==",
  },
};
export const linuxEngines = {
  "0.1.1": {
    name: "code60-transmission-server",
    integrity:
      "sha512-DJ6VnIv1A3Akkux2MptgcbdSuFwP3Afeqyv9x4p1OlzT1hKPLmPKWsrxLmfvv/ol7pahFySdMAWnys3M3DV1Bg==",
  },
};
export function workflowTarget(os = process.platform, arch = process.arch) {
  if (os === "darwin" && arch === "arm64") return macEngines;
  if (os === "linux" && arch === "x64") return linuxEngines;
  throw Error("Workflow execution requires macOS Apple Silicon or Linux x64 with glibc");
}
