import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./styles/tokens.css";
import "./styles/base.css";
import { App } from "./app/App";
import { HudWindow } from "./app/Hud";
import { PadMapWindow } from "./app/PadMap";

const isHud = window.location.hash.startsWith("#/hud");
const isPadMap = window.location.hash.startsWith("#/padmap");

createRoot(document.getElementById("root")!).render(<StrictMode>{isHud ? <HudWindow /> : isPadMap ? <PadMapWindow /> : <App />}</StrictMode>);
