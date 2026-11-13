import { createRoot } from "react-dom/client";
import { App } from "./features/world-console/App";
import "./styles.css";

const element = document.getElementById("root");

if (!element) throw new Error("Missing application root");

createRoot(element).render(<App />);
