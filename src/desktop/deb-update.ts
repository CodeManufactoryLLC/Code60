import { execFile } from "node:child_process";

/** Do not use electron-updater's synchronous shell-based DEB installer. */
export function installDeb(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/pkexec",
      ["/usr/bin/dpkg", "-i", file],
      {
        timeout: 5 * 60_000,
        maxBuffer: 64 * 1024,
        env: { ...process.env, PATH: "/usr/sbin:/usr/bin:/sbin:/bin" },
      },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}
