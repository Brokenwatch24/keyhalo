#!/usr/bin/env node
/**
 * Build the static website into site/dist/ (deployed to GitHub Pages by .github/workflows/pages.yml):
 *   /            English landing page        /es/            Spanish landing page
 *   /gallery/    community gallery (EN)      /es/gallery/    community gallery (ES)
 *   sitemap.xml, robots.txt, 404.html, assets/, screenshots/ (from docs/screenshots), previews/
 *
 * Usage: node scripts/build-site.mjs [--out <dir>]
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, driverLabel, listContentFiles, readJsonSafe, ROOT } from "./lib/community.mjs";
import { CONTENT } from "../site/content.mjs";
import { keyboardSvg, loadLayout } from "../site/keyboard.mjs";
import { esc, galleryPage, homePage, layout, REPO_URL, RELEASES_URL, SITE } from "../site/templates.mjs";

function checkContent() {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const en = new Set(keys(CONTENT.en));
  const es = new Set(keys(CONTENT.es));
  const missing = [...en].filter((k) => !es.has(k)).concat([...es].filter((k) => !en.has(k)));
  if (missing.length) throw new Error(`site/content.mjs: en/es keys differ: ${missing.join(", ")}`);
}

function devicesData(root) {
  const STATUS_ORDER = { verified: 0, community: 1, experimental: 2 };
  return listContentFiles(root)
    .filter((f) => f.kind === "device")
    .map((f) => readJsonSafe(f.file))
    .filter((d) => d && d.id && d.name)
    .map((d) => ({
      name: d.name,
      type: d.type,
      status: d.status ?? "experimental",
      connection: driverLabel(d.driver),
      usb: [...new Set((d.match ?? []).map((m) => `${String(m.vendorId).replace(/^0x/i, "")}:${String(m.productId).replace(/^0x/i, "")}`.toUpperCase()))],
    }))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name));
}

function structuredData(c, { version, url, shots }) {
  const software = {
    "@type": "SoftwareApplication",
    "@id": `${SITE}#app`,
    name: "KeyHalo",
    description: c.description,
    url: SITE,
    applicationCategory: "UtilitiesApplication",
    applicationSubCategory: "Peripheral customization",
    operatingSystem: "Windows 10, Windows 11",
    softwareVersion: version,
    inLanguage: ["en", "es"],
    isAccessibleForFree: true,
    license: "https://opensource.org/licenses/MIT",
    downloadUrl: RELEASES_URL,
    installUrl: RELEASES_URL,
    codeRepository: REPO_URL,
    image: `${SITE}assets/social-preview.png`,
    screenshot: shots.map((s) => `${SITE}screenshots/${s}`),
    featureList: c.features.map((f) => f.title),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@type": "Organization", name: "KeyHalo contributors", url: REPO_URL },
  };
  const source = {
    "@type": "SoftwareSourceCode",
    name: "KeyHalo",
    codeRepository: REPO_URL,
    programmingLanguage: ["TypeScript", "Rust"],
    runtimePlatform: "Tauri",
    license: "https://opensource.org/licenses/MIT",
    targetProduct: { "@id": `${SITE}#app` },
  };
  const website = { "@type": "WebSite", name: "KeyHalo", url: SITE, inLanguage: c.lang };
  const faq = {
    "@type": "FAQPage",
    mainEntity: c.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  void url;
  return [{ "@context": "https://schema.org", "@graph": [software, source, website] }, { "@context": "https://schema.org", ...faq }];
}

export function build({ root = ROOT, out = join(root, "site", "dist") } = {}) {
  checkContent();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "assets"), { recursive: true });

  // Assets ------------------------------------------------------------------
  const src = join(root, "site", "src");
  for (const f of readdirSync(src)) copyFileSync(join(src, f), join(out, "assets", f));
  const font = join(root, "node_modules", "@fontsource-variable", "inter", "files", "inter-latin-wght-normal.woff2");
  if (existsSync(font)) copyFileSync(font, join(out, "assets", "inter.woff2"));
  else console.warn("⚠ Inter font not found in node_modules; falling back to system fonts");
  const social = join(root, "docs", "social-preview.png");
  if (existsSync(social)) copyFileSync(social, join(out, "assets", "social-preview.png"));
  else console.warn("⚠ docs/social-preview.png missing — run `node scripts/social-card.mjs`");

  const shotsDir = join(root, "docs", "screenshots");
  const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)) : [];
  if (shots.length) cpSync(shotsDir, join(out, "screenshots"), { recursive: true, filter: (p) => !/\.(md|txt)$/i.test(p) });

  // Data --------------------------------------------------------------------
  const indexPath = join(root, "community", "index.json");
  const index = existsSync(indexPath) ? readJsonSafe(indexPath) : null;
  const entries = (index?.entries?.length ? index : buildIndex({ root }).index).entries;
  for (const e of entries) {
    if (!e.preview) continue;
    const from = join(root, e.preview);
    if (!existsSync(from)) continue;
    const to = join(out, "previews", e.preview.replace(/^community\//, ""));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  const devices = devicesData(root);
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const kbLayout = loadLayout(root);

  // Pages -------------------------------------------------------------------
  const pages = [];
  for (const lang of ["en", "es"]) {
    const c = CONTENT[lang];
    const prefix = lang === "en" ? "" : "es/";
    const homeUrl = `${SITE}${prefix}`;
    const galleryUrl = `${SITE}${prefix}gallery/`;

    const homeBase = lang === "en" ? "" : "../";
    const home = layout(
      {
        c,
        base: homeBase,
        url: homeUrl,
        title: c.title,
        ogTitle: c.ogTitle,
        description: c.description,
        alternates: { en: SITE, es: `${SITE}es/` },
        homeHref: "./",
        galleryHref: "gallery/",
        langHref: c.nav.languageHref,
        ld: structuredData(c, { version, url: homeUrl, shots: shots.filter((s) => /-dark\.png$/.test(s)) }),
      },
      homePage({
        c,
        version,
        devices,
        shotsBase: `${homeBase}screenshots/`,
        keyboard: keyboardSvg(kbLayout, { unit: 56, id: `kb-${lang}`, title: lang === "es" ? "Teclado con iluminación RGB por tecla controlada por KeyHalo" : undefined }),
      }),
    );
    pages.push([`${prefix}index.html`, home]);

    const galleryBase = lang === "en" ? "../" : "../../";
    const gallery = layout(
      {
        c,
        base: galleryBase,
        url: galleryUrl,
        title: c.gallery.title,
        description: c.gallery.description,
        alternates: { en: `${SITE}gallery/`, es: `${SITE}es/gallery/` },
        homeHref: "../",
        galleryHref: "./",
        langHref: lang === "en" ? "../es/gallery/" : "../../gallery/",
        scripts: `<script src="${galleryBase}assets/gallery.js" defer></script>`,
        ld: [
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: c.gallery.h1,
            description: c.gallery.description,
            url: galleryUrl,
            inLanguage: lang,
            isPartOf: { "@type": "WebSite", name: "KeyHalo", url: SITE },
            mainEntity: {
              "@type": "ItemList",
              numberOfItems: entries.length,
              itemListElement: entries.slice(0, 100).map((e, i) => ({ "@type": "ListItem", position: i + 1, name: e.name, url: `${galleryUrl}#${e.kind}-${e.id}` })),
            },
          },
        ],
      },
      galleryPage({ c, entries, base: galleryBase }),
    );
    pages.push([`${prefix}gallery/index.html`, gallery]);
  }
  pages.push([
    "404.html",
    layout(
      {
        c: CONTENT.en,
        base: "/keyhalo/",
        url: SITE,
        title: "Page not found — KeyHalo",
        description: CONTENT.en.description,
        alternates: { en: SITE, es: `${SITE}es/` },
        homeHref: "/keyhalo/",
        galleryHref: "/keyhalo/gallery/",
        langHref: "/keyhalo/es/",
      },
      `<div class="wrap page-head" style="padding-bottom:80px"><h1>Page not found</h1><p>This page doesn't exist. <a href="/keyhalo/">Go to the KeyHalo home page</a> or <a href="/keyhalo/gallery/">browse the community gallery</a>.</p></div>`,
    ).replace("<meta name=\"robots\" content=\"index, follow, max-image-preview:large\">", '<meta name="robots" content="noindex">'),
  ]);
  for (const [rel, html] of pages) {
    const p = join(out, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, html);
  }

  // SEO files ----------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const urlEntry = (en, es, priority) =>
    [en, es]
      .map(
        (loc) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <priority>${priority}</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${en}"/>
    <xhtml:link rel="alternate" hreflang="es" href="${es}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>
  </url>`,
      )
      .join("\n");
  writeFileSync(
    join(out, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urlEntry(SITE, `${SITE}es/`, "1.0")}
${urlEntry(`${SITE}gallery/`, `${SITE}es/gallery/`, "0.8")}
</urlset>
`,
  );
  writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
  writeFileSync(join(out, ".nojekyll"), "");

  return { out, pages: pages.map(([p]) => p), entries: entries.length, devices: devices.length, screenshots: shots.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const res = build(i > 0 ? { out: resolve(process.argv[i + 1]) } : {});
  console.log(`✔ site built in ${res.out}\n  pages: ${res.pages.join(", ")}\n  gallery entries: ${res.entries} · devices: ${res.devices} · screenshots: ${res.screenshots}`);
}

export { esc };
