import { greet } from "virtual:shadow-cljs/app";

function render() {
  document.getElementById("app").textContent = greet("World");
}

render();

if (import.meta.hot) {
  import.meta.hot.accept(() => render());
}
