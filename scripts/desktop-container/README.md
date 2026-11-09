# Desktop test container

Run from the repository with `npm run test:desktop:container`. See
[Contributing](../../CONTRIBUTING.md#desktop-tests-in-a-linux-container) for usage.

**This is the default for automated desktop tests, including focused and repeated
runs.** Do not fall back to tests that open windows on the user's desktop if
Docker or a build fails. Report the blocker; host UI testing requires the user's
explicit approval for that run.

`seccomp.json` is based on Microsoft Playwright commit
`ae935a43d9e376e4759548f6b3c6905c7b282333`:
https://github.com/microsoft/playwright/blob/ae935a43d9e376e4759548f6b3c6905c7b282333/utils/docker/seccomp_profile.json

It permits `clone`, `setns`, and `unshare` for Chromium's user-namespace sandbox
while retaining Docker's syscall filtering. The profile supports ARM64 and x64.
The upstream Apache-2.0 license is included as `LICENSE.playwright`. Review
upstream changes and test both architectures before replacing this profile.

Local modification: `clone3` explicitly returns `ENOSYS` (38), matching Docker's
modern default profile. Bookworm glibc can then fall back to the permitted `clone`
syscall; the older profile's default `EPERM` prevents that fallback.
