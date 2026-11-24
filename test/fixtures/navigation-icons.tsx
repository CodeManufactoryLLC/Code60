import { createRoot } from "react-dom/client";
import { pages, settingsSections } from "../../src/contracts/navigation.js";
import { NavigationIcon, type NavigationIconName } from "../../src/renderer/navigation-icons.js";
import "../../src/renderer/styles/navigation.css";
import "./navigation-icons.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <main>
    {(
      [
        ...new Set([...pages, ...settingsSections].map((item) => item.icon).filter(Boolean)),
      ] as NavigationIconName[]
    ).map((name) => (
      <div className="fixture-row" key={name}>
        <div className="fixture-icon">
          <NavigationIcon name={name} />
        </div>
        <span>{name}</span>
      </div>
    ))}
  </main>,
);
