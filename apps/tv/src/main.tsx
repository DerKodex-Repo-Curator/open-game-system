import { createRoot } from "react-dom/client";
import { boot } from "./boot";
import { parseParams } from "./params";
import { PRODUCTION_API, screenParams } from "./screen/pairing";
import { App } from "./ui/App";
import { BadUrl } from "./ui/BadUrl";
import { ScreenApp } from "./ui/ScreenApp";
import "./ui/styles.css";

const root = document.getElementById("root");
const search = window.location.search;
// No launcher link: this browser is a screen that pairs with a phone (2026-10-17-browser-tv.feature).
const screen = screenParams(search, import.meta.env.VITE_OGS_API ?? PRODUCTION_API);
const parsed = parseParams(search);
if (root) {
  createRoot(root).render(
    screen ? (
      <ScreenApp api={screen.api} search={search} />
    ) : parsed.ok ? (
      <App boot={boot(parsed.params, search)} />
    ) : (
      <BadUrl />
    ),
  );
}
