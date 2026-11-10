import { execFileSync } from "node:child_process";

// Azure Artifact Signing issues a new short-lived leaf certificate for each signing
// session and rotates its intermediate CAs, so pin the validated publisher name and
// Microsoft's identity-verification root instead of a certificate thumbprint.
const signingRoot = "Microsoft Identity Verification Root Certificate Authority 2020";

// Fixed PowerShell code, values passed through the environment, never interpolated.
// This neither changes execution policy nor logs certificates or signing settings.
const verify = `
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $env:CODE60_VERIFY_FILE
if ($signature.Status -ne 'Valid') { throw 'Authenticode signature is not valid' }
if (-not $signature.TimeStamperCertificate) { throw 'Authenticode timestamp is missing' }
$simple = [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName
$signer = $signature.SignerCertificate
if ($signer.GetNameInfo($simple, $false) -cne $env:WIN_SIGNING_PUBLISHER) {
  throw 'Unexpected signing publisher'
}
$chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
$chain.ChainPolicy.RevocationMode = 'NoCheck'
# The timestamp, already checked by Get-AuthenticodeSignature, extends the short-lived leaf.
$chain.ChainPolicy.VerificationFlags = 'IgnoreNotTimeValid'
if (-not $chain.Build($signer)) { throw 'Signing certificate chain is not trusted' }
$root = $chain.ChainElements[$chain.ChainElements.Count - 1].Certificate
if ($root.GetNameInfo($simple, $false) -cne $env:CODE60_SIGNING_ROOT) {
  throw 'Unexpected signing certificate authority'
}
`;

export function validPublisher(name) {
  return typeof name === "string" && /^[^\p{Cc}]{1,200}$/u.test(name) && name.trim() === name;
}

export function verifyWindowsSignature(file) {
  if (process.platform !== "win32") throw new Error("Verify Authenticode on Windows");
  if (!validPublisher(process.env.WIN_SIGNING_PUBLISHER))
    throw new Error("Set WIN_SIGNING_PUBLISHER to the validated certificate publisher name");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", verify], {
    env: { ...process.env, CODE60_VERIFY_FILE: file, CODE60_SIGNING_ROOT: signingRoot },
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
}
