import { useState } from "react";
import { greet, add, fibonacci } from "virtual:shadow-cljs/app";

export default function App() {
  const [name, setName] = useState("World");
  const [fibN, setFibN] = useState(10);

  return (
    <div
      style={{
        fontFamily: "system-ui",
        maxWidth: 600,
        margin: "0 auto",
        padding: 20,
      }}
    >
      <h1>CLJS + React Example</h1>

      <section>
        <h2>Greeting (from CLJS)</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ fontSize: 16, padding: 4 }}
        />
        <p>{greet(name)}</p>
      </section>

      <section>
        <h2>Addition (from CLJS)</h2>
        <p>add(21, 21) = {add(21, 21)}</p>
      </section>

      <section>
        <h2>Fibonacci (from CLJS)</h2>
        <label>
          n ={" "}
          <input
            type="number"
            value={fibN}
            onChange={(e) => setFibN(Number(e.target.value))}
            style={{ width: 60, fontSize: 16, padding: 4 }}
          />
        </label>
        <p>
          fibonacci({fibN}) = [{fibonacci(fibN).join(", ")}]
        </p>
      </section>
    </div>
  );
}
