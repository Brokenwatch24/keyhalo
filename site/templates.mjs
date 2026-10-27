/**
 * HTML templates for the static website (no framework). Every page is fully rendered at build
 * time for SEO; the only script is the gallery filter.
 */
import { PALETTE, paletteAt } from "./keyboard.mjs";

export const SITE = "https://brokenwatch24.github.io/keyhalo/";
export const REPO_URL = "https://github.com/Brokenwatch24/keyhalo";
export const RELEASES_URL = `${REPO_URL}/releases/latest`;

export const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

const ICONS = {
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><path d="M16 4a4 4 0 0 1 0 8"/><path d="M22 21v-1a6 6 0 0 0-4-5.6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
const GITHUB_MARK =
  '<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d6d"/><stop offset=".35" stop-color="#ffb703"/><stop offset=".65" stop-color="#3ddc97"/><stop offset="1" stop-color="#4c6fff"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="9" fill="none" stroke="url(#lg)" stroke-width="2.5"/><rect x="8.5" y="8.5" width="15" height="15" rx="4.5" fill="currentColor"/></svg>`;

/**
 * <head> + header shell.
 * @param {object} p { c, page: "home"|"gallery", base (relative prefix to site root), url (absolute), alternates: {en, es}, title, description, ld: [] }
 */
export function layout(p, body) {
  const { c, base } = p;
  const og = `${SITE}assets/social-preview.png`;
  return `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${p.url}">
<link rel="alternate" hreflang="en" href="${p.alternates.en}">
<link rel="alternate" hreflang="es" href="${p.alternates.es}">
<link rel="alternate" hreflang="x-default" href="${p.alternates.en}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#09090b">
<meta name="color-scheme" content="dark light">
<meta property="og:type" content="website">
<meta property="og:site_name" content="KeyHalo">
<meta property="og:locale" content="${c.locale}">
<meta property="og:title" content="${esc(p.ogTitle ?? p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${p.url}">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta property="og:image:alt" content="KeyHalo — keyboard with per-key RGB lighting">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.ogTitle ?? p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${og}">
<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${base}assets/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${base}assets/styles.css">
${(p.ld ?? []).map(jsonLd).join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${p.homeHref}" aria-label="KeyHalo home">${LOGO}<span>KeyHalo</span></a>
    <nav class="site-nav" aria-label="Main">
      <a href="${p.homeHref}#features">${esc(c.nav.features)}</a>
      <a href="${p.homeHref}#screenshots">${esc(c.nav.screenshots)}</a>
      <a href="${p.homeHref}#devices">${esc(c.nav.devices)}</a>
      <a href="${p.homeHref}#faq">${esc(c.nav.faq)}</a>
      <a class="keep" href="${p.galleryHref}">${esc(c.nav.gallery)}</a>
      <a href="${REPO_URL}" rel="noopener">${esc(c.nav.github)}</a>
      <a class="keep lang" href="${p.langHref}" hreflang="${c.lang === "en" ? "es" : "en"}" lang="${c.lang === "en" ? "es" : "en"}">${esc(c.nav.language)}</a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
${footer(c)}
${p.scripts ?? ""}
</body>
</html>
`;
}

function footer(c) {
  return `<footer class="site-footer">
  <div class="wrap">
    <hr class="spectrum-rule">
    <div class="top">
      <div><strong style="color:var(--text)">KeyHalo</strong> — ${esc(c.footer.tagline)}</div>
      <nav aria-label="Footer">
        <a href="${RELEASES_URL}">${esc(c.footer.links.releases)}</a>
        <a href="${REPO_URL}/issues">${esc(c.footer.links.issues)}</a>
        <a href="${REPO_URL}/blob/main/CONTRIBUTING.md">${esc(c.footer.links.contributing)}</a>
        <a href="${REPO_URL}/blob/main/SECURITY.md">${esc(c.footer.links.security)}</a>
        <a href="${REPO_URL}/blob/main/LICENSE">${esc(c.footer.license)}</a>
      </nav>
    </div>
    <p style="margin:0">${esc(c.footer.disclaimer)}</p>
  </div>
</footer>`;
}

export function homePage({ c, keyboard, devices, version, shotsBase }) {
  const hero = `<section class="hero" aria-labelledby="hero-title">
  <div class="wrap">
    <span class="eyebrow">${esc(c.hero.eyebrow)}</span>
    <h1 id="hero-title">${esc(c.hero.h1)}</h1>
    <p class="lead">${esc(c.hero.lead)}</p>
    <div class="cta">
      <a class="btn primary" href="${RELEASES_URL}">${icon("download")}${esc(c.hero.download)}</a>
      <a class="btn" href="${REPO_URL}" rel="noopener">${GITHUB_MARK}${esc(c.hero.github)}</a>
    </div>
    <ul class="hero-meta">${c.hero.meta.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
    <div class="hero-art">${keyboard}</div>
  </div>
</section>`;

  const features = `<section id="features" aria-labelledby="features-title">
  <div class="wrap">
    <div class="section-head"><h2 id="features-title">${esc(c.featuresTitle)}</h2><p>${esc(c.featuresLead)}</p></div>
    <div class="features">
      ${c.features.map((f) => `<article class="feature"><div class="icon">${icon(f.icon)}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></article>`).join("\n      ")}
    </div>
  </div>
</section>`;

  const shots = `<section id="screenshots" aria-labelledby="shots-title">
  <div class="wrap">
    <div class="section-head"><h2 id="shots-title">${esc(c.screenshotsTitle)}</h2><p>${esc(c.screenshotsLead)}</p></div>
    <div class="shots">
      ${c.shots
        .map(
          (s, i) => `<figure><picture><source media="(prefers-color-scheme: light)" srcset="${shotsBase}${s.route}-light.png"><img src="${shotsBase}${s.route}-dark.png" alt="KeyHalo ${esc(s.caption)}" width="1440" height="900" ${i ? 'loading="lazy"' : 'fetchpriority="low"'} decoding="async" onerror="this.closest('figure').hidden=true"></picture><figcaption>${esc(s.caption)}</figcaption></figure>`,
        )
        .join("\n      ")}
    </div>
  </div>
</section>`;

  const deviceRows = devices
    .map(
      (d) =>
        `<tr><td>${esc(d.name)}</td><td>${esc(c.types[d.type] ?? d.type)}</td><td>${esc(d.connection)}</td><td>${d.usb.map((u) => `<code>${esc(u)}</code>`).join(" ")}</td><td><span class="pill ${esc(d.status)}">${esc(c.status[d.status] ?? d.status)}</span></td></tr>`,
    )
    .join("\n          ");
  const devicesSection = `<section id="devices" aria-labelledby="devices-title">
  <div class="wrap">
    <div class="section-head"><h2 id="devices-title">${esc(c.devicesTitle)}</h2><p>${esc(c.devicesLead)}</p></div>
    <div class="table-wrap">
      <table>
        <thead><tr>${c.devicesCols.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>
          ${deviceRows}
          <tr><td>${c.lang === "es" ? "Cualquier dispositivo Windows Dynamic Lighting" : "Any Windows Dynamic Lighting device"}</td><td>${c.lang === "es" ? "Teclado / ratón" : "Keyboard / mouse"}</td><td>Windows Dynamic Lighting</td><td>—</td><td><span class="pill community">LampArray</span></td></tr>
        </tbody>
      </table>
    </div>
    <p class="note">${esc(c.devicesNote)}</p>
    <div class="row-cta">
      <a class="btn small" href="${REPO_URL}/issues/new?template=device_request.yml">${esc(c.devicesCta)}</a>
      <a class="btn small" href="${REPO_URL}/blob/main/CONTRIBUTING.md#device-definitions">${esc(c.contributeCta)}</a>
    </div>
  </div>
</section>`;

  const faq = `<section id="faq" aria-labelledby="faq-title">
  <div class="wrap">
    <div class="section-head"><h2 id="faq-title">${esc(c.faqTitle)}</h2></div>
    <div class="faq">
      ${c.faq.map((f, i) => `<details${i === 0 ? " open" : ""}><summary><h3 style="all:unset">${esc(f.q)}</h3></summary><p>${esc(f.a)}</p></details>`).join("\n      ")}
    </div>
  </div>
</section>`;

  const community = `<section id="community" aria-labelledby="community-title">
  <div class="wrap">
    <div class="section-head"><h2 id="community-title">${esc(c.communityTitle)}</h2><p>${esc(c.communityLead)}</p></div>
    <div class="steps">
      ${c.communitySteps.map((s) => `<article class="step"><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></article>`).join("\n      ")}
    </div>
    <div class="row-cta">
      <a class="btn primary" href="gallery/">${esc(c.communityCta)}</a>
      <a class="btn" href="${REPO_URL}/blob/main/CONTRIBUTING.md">${esc(c.contributeCta)}</a>
    </div>
  </div>
</section>`;

  void version;
  return [hero, features, shots, devicesSection, faq, community].join("\n");
}

/** Decorative thumbnail for gallery items without a preview image. */
export function glyph(entry) {
  let h = 0;
  for (const ch of `${entry.kind}:${entry.id}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const offset = (h % 1000) / 1000;
  const cols = 14;
  const rows = 4;
  const rects = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const t = ((x + y * 0.6) / (cols + rows * 0.6) + offset) % 1;
      const col = entry.kind === "device" ? "#3f3f46" : paletteAt(t);
      rects.push(`<rect x="${12 + x * 20}" y="${14 + y * 20}" width="16" height="16" rx="3.5" fill="${col}" fill-opacity="${entry.kind === "device" ? 0.9 : 0.85}"/>`);
    }
  return `<svg class="glyph" viewBox="0 0 304 112" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="304" height="112" fill="#0c0c0e"/>${rects.join("")}</svg>`;
}

export function galleryPage({ c, entries, base }) {
  const kinds = ["profile", "keymap", "effect", "device", "typing"].filter((k) => entries.some((e) => e.kind === k));
  const counts = Object.fromEntries(kinds.map((k) => [k, entries.filter((e) => e.kind === k).length]));
  const g = c.gallery;
  const cards = entries
    .map((e) => {
      const thumb = e.preview ? `<img src="${base}previews/${esc(e.preview.replace(/^community\//, ""))}" alt="${esc(e.name)} preview" loading="lazy" decoding="async">` : glyph(e);
      const tags = (e.tags ?? []).slice(0, 5).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
      const deep = `keyhalo://install?kind=${encodeURIComponent(e.kind)}&id=${encodeURIComponent(e.id)}`;
      return `<article class="card" data-card data-card-kind="${e.kind}" id="${e.kind}-${esc(e.id)}">
  <div class="thumb">${thumb}</div>
  <div class="body">
    <div class="meta"><span>${esc(g.kind[e.kind])}</span>${e.status ? `<span class="pill ${esc(e.status)}">${esc(c.status[e.status] ?? e.status)}</span>` : ""}${e.author ? `<span>${esc(g.by)} ${esc(e.author)}</span>` : ""}</div>
    <h2>${esc(e.name)}</h2>
    ${e.description ? `<p>${esc(e.description)}</p>` : ""}
    ${e.apps?.length ? `<div class="meta">${e.apps.map((a) => `<code>${esc(a)}</code>`).join(" ")}</div>` : ""}
    ${tags ? `<div class="meta">${tags}</div>` : ""}
    ${e.tags?.includes("macros") ? `<div class="warn">⚠ ${esc(g.macros)}</div>` : ""}
    <div class="actions"><a class="btn small primary" href="${deep}">${esc(g.open)}</a><a class="btn small" href="${REPO_URL}/blob/main/${esc(e.path)}" rel="noopener">${esc(g.source)}</a></div>
  </div>
</article>`;
    })
    .join("\n");
  return `<div class="wrap">
  <div class="page-head"><h1>${esc(g.h1)}</h1><p>${esc(g.lead)}</p></div>
  <div class="toolbar">
    <input class="search" type="search" placeholder="${esc(g.search)}" aria-label="${esc(g.search)}" data-search>
    <div class="chips" role="group" aria-label="Filter">
      <button class="chip" type="button" data-kind="all" aria-pressed="true">${esc(g.all)}<span class="n">${entries.length}</span></button>
      ${kinds.map((k) => `<button class="chip" type="button" data-kind="${k}" aria-pressed="false">${esc(g.kinds[k])}<span class="n">${counts[k]}</span></button>`).join("\n      ")}
    </div>
    <a class="btn small" href="${REPO_URL}/blob/main/CONTRIBUTING.md">${esc(g.share)}</a>
  </div>
  <div class="cards">
${cards}
  </div>
  <p class="empty" data-empty hidden>${esc(g.empty)}</p>
</div>`;
}

export { PALETTE };
