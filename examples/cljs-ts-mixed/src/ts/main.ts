// Import the ClojureScript build via virtual module
import * as cljs from "virtual:shadow-cljs/app";

// TS can also use its own modules directly
import { formatUpperCase } from "./format";

// Render to the page
const app = document.getElementById("app")!;
app.innerHTML = `
  <h1>CLJS + TypeScript Mixed Example</h1>

  <h2>TS calling CLJS</h2>
  <p>${cljs.greet("World")}</p>
  <p>add(21, 21) = ${cljs.add(21, 21)}</p>

  <h2>CLJS calling TS</h2>
  <p>${cljs.formattedGreeting("Alice")}</p>

  <h2>TS calling TS</h2>
  <p>${formatUpperCase("hello from typescript")}</p>
`;
