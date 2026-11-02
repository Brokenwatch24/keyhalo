import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./prompt.css";

interface Question {
  id: string;
  title: string;
  value?: string;
  placeholder?: string;
  hint?: string;
}

/** Route #/prompt: the small text box pads open (Enter answers, Esc cancels). */
export function PromptWindow() {
  const [q, setQ] = useState<Question | null>(null);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const focus = () => input.current?.focus();
    const un = listen<Question>("prompt-open", (e) => {
      setQ(e.payload);
      setText(e.payload.value ?? "");
      setTimeout(focus, 30);
    });
    window.addEventListener("focus", focus);
    return () => {
      un.then((f) => f());
      window.removeEventListener("focus", focus);
    };
  }, []);

  if (!q) return null;
  const answer = (value: string | null) => {
    void invoke("prompt_submit", { id: q.id, value });
    setQ(null);
  };
  return (
    <div className="kh-prompt-window">
      <form
        className="kh-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          answer(text);
        }}
      >
        <div className="kh-prompt__title">{q.title}</div>
        <input
          ref={input}
          autoFocus
          value={text}
          placeholder={q.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && answer(null)}
        />
        <div className="kh-prompt__hint">{q.hint ?? "Enter ✓   ·   Esc ✕"}</div>
      </form>
    </div>
  );
}
