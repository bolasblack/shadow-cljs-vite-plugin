// Import the ClojureScript build via virtual module
import { exports as cljs_exports } from "virtual:shadow-cljs/app";
import * as cljs from "virtual:shadow-cljs/app";

// TS can also use its own modules directly
import { formatUpperCase } from "./format";

// Render to the page
function render() {
  const app = document.getElementById("app")!;
  app.innerHTML = `
    <h1>CLJS + TypeScript Mixed Example</h1>

    <h2>TS calling CLJS</h2>
    <p>${cljs.greet("World")}</p>
    <p>add(21, 21) = ${cljs_exports.add(21, 21)}</p>

    <h2>CLJS calling TS</h2>
    <p>${cljs.formattedGreeting("Alice")}</p>

    <h2>TS calling TS</h2>
    <p>${formatUpperCase("hello from typescript")}</p>
  `;
}

render();

// HMR: the plugin sends js-update for importers after shadow-cljs
// hot-reloads.  Self-accept so Vite re-runs render() instead of
// doing a full page reload.
if (import.meta.hot) {
  import.meta.hot.accept(() => render());
}
