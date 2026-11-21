/** Fail before running POSIX operations on an unsupported host. */
export function assertSupportedPlatform(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "darwin" && platform !== "linux")
    throw new Error("Code60 supports macOS and Linux only");
}
