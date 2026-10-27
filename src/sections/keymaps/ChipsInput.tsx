import { useId, useState } from "react";
import { X } from "lucide-react";
import { cx } from "./util";
import "./keymaps.css";

/** Editable list of short strings (process names…) as removable chips, with datalist suggestions. */
export function ChipsInput({
  value,
  onChange,
  suggestions = [],
  placeholder,
  mono = true,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  mono?: boolean;
}) {
  const [text, setText] = useState("");
  const listId = useId();
  const add = (raw: string) => {
    const parts = raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const lower = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const p of parts) if (!lower.has(p.toLowerCase())) next.push(p);
    onChange(next);
    setText("");
  };
  return (
    <div className="keymaps-chips" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}>
      {value.map((v) => (
        <span key={v} className={cx("keymaps-chips__chip", mono && "mono")}>
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
            <X />
          </button>
        </span>
      ))}
      <input
        list={listId}
        value={text}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (suggestions.includes(v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => text && add(text)}
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
