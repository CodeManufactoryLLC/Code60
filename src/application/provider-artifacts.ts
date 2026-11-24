// Fixed release artifacts. Never supplied or selected by browser callers.
import type { ProviderArtifact } from "./provider-archive.js";
export interface ManagedProviderRelease {
  version: string;
  binary: string;
  archives: Record<string, ProviderArtifact>;
  adapter?: ProviderArtifact;
}
export const PROVIDER_RELEASES: Record<string, ManagedProviderRelease> = {
  copilot: {
    version: "1.0.114",
    binary: "package/copilot",
    archives: {
      "linux-x64": {
        url: "https://registry.npmjs.org/@github/copilot-linux-x64/-/copilot-linux-x64-1.0.114.tgz",
        integrity:
          "sha512-gHnINm9ffFqz+G19cQUqRe3lsTAQO3Tbdj7r7Bx1ktZvC5X6iXd/nfo1DRTj9magb52aGRiuwB3yvD1lkW68xQ==",
      },
      "darwin-arm64": {
        url: "https://registry.npmjs.org/@github/copilot-darwin-arm64/-/copilot-darwin-arm64-1.0.114.tgz",
        integrity:
          "sha512-Mw47DTwMNDG0bb4t1rVu7S+ekdThIGGitpG28/wGpACZ0lFhYnpNEoSJ7hHBM3oix4b/w6+ZcmxE9J9MngsR9Q==",
      },
    },
  },
  claude: {
    version: "2.1.331",
    binary: "package/claude",
    archives: {
      "linux-x64": {
        url: "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.331.tgz",
        integrity:
          "sha512-IpvZ9c/NopO/sr8ThWLVAUDXVAFT3auLWrhbR6wq1dgkuJfZYdTtoXf6GajE5KL9R58iTt/86OPXrJAsM4+l8g==",
      },
      "darwin-arm64": {
        url: "https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.331.tgz",
        integrity:
          "sha512-SVQmG05M7G/Lrbr3qUXDQXaV6+jEHudR9rSdsGjM0/zBjbZJh/mC812DwT3rHCA8rGlPC+HLfTwbvqmNQWNJZw==",
      },
    },
    adapter: {
      url: "https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp/-/claude-agent-acp-0.110.1.tgz",
      integrity:
        "sha512-zIPjFWEU4yit7NHSMFk3W8Coh05GP+S5YLMXZB+t4YF+oQMfxRS+WXWSKnUgWPMsS0BUQnEHTurAgHsgWBiHPQ==",
    },
  },
  droid: {
    version: "1.18.0",
    binary: "package/bin/droid",
    archives: {
      "linux-x64": {
        url: "https://registry.npmjs.org/@factory/cli-linux-x64-baseline/-/cli-linux-x64-baseline-1.18.0.tgz",
        integrity:
          "sha512-YqFPOSRHP9kB0Wtbd/+g/x1eMvgLwMneck45NfIJ/D6AjFl22bVYUW19mlTFaybMTQckWLZZK7PP3qXypUQZOA==",
      },
      "darwin-arm64": {
        url: "https://registry.npmjs.org/@factory/cli-darwin-arm64/-/cli-darwin-arm64-1.18.0.tgz",
        integrity:
          "sha512-zTtXd8N1mbnnLTjxgUvjn15LBWY5KwmCNrsMGqU9PlHD8DeVckYDunc+bRXxncWOsQiROieI7ZfSjNTiku2SGw==",
      },
    },
  },
  opencode: {
    version: "1.19.6",
    binary: "package/bin/opencode",
    archives: {
      "linux-x64": {
        url: "https://registry.npmjs.org/opencode-linux-x64-baseline/-/opencode-linux-x64-baseline-1.19.6.tgz",
        integrity:
          "sha512-514i1cj8ZGcgQKXg3EqAe2YVV5ID7EK3u6LuIqsSPhpVnWDwWjiJejYzhOWHbRMYpfbVbt6DHabs9BUbwHn7zg==",
      },
      "darwin-arm64": {
        url: "https://registry.npmjs.org/opencode-darwin-arm64/-/opencode-darwin-arm64-1.19.6.tgz",
        integrity:
          "sha512-GZjEsOTlr/e8fUF+lsFtTJGNIyHfUZcN9+iN6uXAbsH6t1PJABZrWE+5Lu2raX7g/EUXXCCB9NJ9L0AyMcWkKA==",
      },
    },
  },
  antigravity: {
    version: "1.5.15",
    binary: "antigravity",
    archives: {
      "darwin-arm64": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.15-5514532022517760/darwin-arm/cli_mac_arm64.tar.gz",
        integrity:
          "sha512-sDqEHrOim+kYpmlgt3X2jtTzvMAvM5YhMbu8JsRuqYPOrGyDKtRu/RHXPZosuX30qyTUvJLuR9PV7Oe42LYSNQ==",
      },
      "linux-x64": {
        url: "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.15-5514532022517760/linux-x64/cli_linux_x64.tar.gz",
        integrity:
          "sha512-rz8L5YuEdZQNefmr6hnnYuzD0mXqn1bP+N2AXie6KZtEowWnlQSn/+br36KaKUxW7cTK7Rh1mQv68v7xUI7IsA==",
      },
    },
  },
  kiro: {
    version: "3.5.0",
    binary: "kirocli/bin/kiro-cli",
    archives: {
      "linux-x64": {
        url: "https://prod.download.cli.kiro.dev/stable/3.5.0/kirocli-x86_64-linux.tar.gz",
        integrity: "sha256-mPAWt0azQtgzeg6TfKvsw4EDfi6SDqD/quZJ5R71nU4=",
      },
      "darwin-arm64": {
        url: "https://prod.download.cli.kiro.dev/stable/3.5.0/kirocli-universal-darwin.tar.gz",
        integrity: "sha256-byb1H+iy8m2wWORa0tT4vOd6SRZ7J9otzmcClSo2MNs=",
      },
    },
  },
};
