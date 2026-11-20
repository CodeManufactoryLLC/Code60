import { createRoot } from "react-dom/client";
import viewBoxes from "../../src/renderer/navigation-icon-viewboxes.json" with { type: "json" };
import { NavigationIcon, type NavigationIconName } from "../../src/renderer/navigation-icons.js";
import "../../src/renderer/styles/navigation.css";
import "./navigation-icons.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <main>
    {(Object.keys(viewBoxes) as NavigationIconName[]).map((name) => (
      <div className="fixture-row" key={name}>
        <div className="fixture-icon">
          <NavigationIcon name={name} />
        </div>
        <span>{name}</span>
      </div>
    ))}
  </main>,
);
