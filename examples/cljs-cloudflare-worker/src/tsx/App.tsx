import { useState } from "react";
import { greet, add } from "virtual:shadow-cljs/browser";

export default function App() {
  const [name, setName] = useState("World");

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 600, margin: "0 auto", padding: 20 }}>
      <h1>CLJS + Cloudflare Worker</h1>

      <section>
        <h2>Browser (CLJS via virtual module)</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ fontSize: 16, padding: 4 }}
        />
        <p>{greet(name)}</p>
        <p>add(21, 21) = {add(21, 21)}</p>
      </section>

      <section>
        <h2>Worker SSR (try in terminal)</h2>
        <pre style={{ background: "#f5f5f5", padding: 12, borderRadius: 4 }}>
          {`curl http://localhost:5173/api/greet?name=${name}`}
        </pre>
      </section>
    </div>
  );
}
