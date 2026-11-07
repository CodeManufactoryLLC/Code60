import { execFileSync } from "node:child_process";

// Fixed PowerShell code, paths passed through the environment, never interpolated.
// This neither changes execution policy nor logs certificates or signing settings.
const verify = `
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $env:CODE60_VERIFY_FILE
if ($signature.Status -ne 'Valid') { throw 'Authenticode signature is not valid' }
if (-not $signature.TimeStamperCertificate) { throw 'Authenticode timestamp is missing' }
if ($signature.SignerCertificate.Thumbprint -ne $env:WIN_SIGNING_THUMBPRINT) {
  throw 'Unexpected signing certificate'
}
`;

export function verifyWindowsSignature(file) {
  if (process.platform !== "win32") throw new Error("Verify Authenticode on Windows");
  if (!/^[a-f\d]{40}$/i.test(process.env.WIN_SIGNING_THUMBPRINT || ""))
    throw new Error("Set WIN_SIGNING_THUMBPRINT to the expected certificate thumbprint");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", verify], {
    env: { ...process.env, CODE60_VERIFY_FILE: file },
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
}
