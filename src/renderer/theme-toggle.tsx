import type { Theme } from "./appearance.js";
import { NavigationIcon } from "./navigation-icons.js";

const modes = {
  system: { label: "System", next: "dark", nextLabel: "Dark", icon: "app-theme-system" },
  dark: { label: "Dark", next: "light", nextLabel: "Light", icon: "app-theme-dark" },
  light: { label: "Light", next: "system", nextLabel: "System", icon: "app-theme-light" },
} as const;

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange(theme: Theme): void }) {
  const mode = modes[theme];
  const label = `Color theme: ${mode.label}. Switch to ${mode.nextLabel} mode`;
  return (
    <button
      type="button"
      className="icon-button breadcrumb-theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => onChange(mode.next)}
    >
      <NavigationIcon name={mode.icon} />
    </button>
  );
}
