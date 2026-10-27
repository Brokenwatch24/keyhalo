// Gallery search + kind filter (progressive enhancement: every card is in the HTML already).
(() => {
  const search = document.querySelector("[data-search]");
  const chips = [...document.querySelectorAll("[data-kind]")];
  const cards = [...document.querySelectorAll("[data-card]")];
  const empty = document.querySelector("[data-empty]");
  if (!search || !cards.length) return;
  let kind = "all";
  const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const apply = () => {
    const terms = norm(search.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const c of cards) {
      const text = c.dataset.text;
      const ok = (kind === "all" || c.dataset.cardKind === kind) && terms.every((t) => text.includes(t));
      c.hidden = !ok;
      if (ok) shown++;
    }
    if (empty) empty.hidden = shown > 0;
    const params = new URLSearchParams(location.search);
    search.value ? params.set("q", search.value) : params.delete("q");
    kind !== "all" ? params.set("kind", kind) : params.delete("kind");
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  };
  for (const c of cards) c.dataset.text = norm(c.textContent || "");
  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      kind = chip.dataset.kind;
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      apply();
    }),
  );
  search.addEventListener("input", apply);
  const params = new URLSearchParams(location.search);
  if (params.get("q")) search.value = params.get("q");
  const k = params.get("kind");
  const chip = chips.find((c) => c.dataset.kind === k);
  if (chip) chip.click();
  else apply();
})();
