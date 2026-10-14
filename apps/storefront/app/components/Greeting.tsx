"use client";

// "午安 · 2026.10.13" kicker from the prototype: time of day plus today's date, computed in the
// browser (the export is static). Renders nothing until hydrated so there is no mismatch.
import { useEffect, useState } from "react";

export function Greeting() {
  const [text, setText] = useState("");
  useEffect(() => {
    const d = new Date();
    const h = d.getHours();
    const word = h < 11 ? "早安" : h < 18 ? "午安" : "晚安";
    const pad = (n: number) => String(n).padStart(2, "0");
    setText(`${word} · ${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`);
  }, []);
  return (
    <span className="kicker" aria-hidden={text ? undefined : true}>
      {text || " "}
    </span>
  );
}
