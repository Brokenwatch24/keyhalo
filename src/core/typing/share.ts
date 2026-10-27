import type { KeyDef, TypingResult } from "../types";
import { heatColor, keyHeat } from "./progress";

/**
 * 1200×630 share card (Open Graph size). Uses fixed colours on purpose: the card must look
 * the same wherever it is posted, independent of the viewer's theme.
 */

export interface ShareCardInput {
  result: TypingResult;
  keys: KeyDef[];
  size: { w: number; h: number };
  labels?: Record<string, string>;
  /** Already-translated strings. */
  text: { mode: string; wpm: string; accuracy: string; consistency: string; raw: string; time: string; date: string; tagline: string };
}

const W = 1200;
const H = 630;
const SANS = `"Inter Variable", Inter, system-ui, "Segoe UI", sans-serif`;
const MONO = `"JetBrains Mono", ui-monospace, Consolas, monospace`;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const g = ctx.createLinearGradient(x, y, x + s, y + s);
  g.addColorStop(0, "#ff4d6d");
  g.addColorStop(0.35, "#ffb703");
  g.addColorStop(0.65, "#3ddc97");
  g.addColorStop(1, "#4c6fff");
  ctx.lineWidth = s * 0.08;
  ctx.strokeStyle = g;
  roundRect(ctx, x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88, s * 0.28);
  ctx.stroke();
  ctx.fillStyle = "#ededef";
  roundRect(ctx, x + s * 0.27, y + s * 0.27, s * 0.46, s * 0.46, s * 0.14);
  ctx.fill();
}

export async function renderShareCard(input: ShareCardInput): Promise<HTMLCanvasElement> {
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts API unavailable */
  }
  const { result, text } = input;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background: near-black with a faint vignette and hairline frame.
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W * 0.25, H * 0.1, 0, W * 0.25, H * 0.1, W * 0.9);
  vg.addColorStop(0, "rgba(255,255,255,0.05)");
  vg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#232327";
  ctx.lineWidth = 2;
  roundRect(ctx, 16, 16, W - 32, H - 32, 22);
  ctx.stroke();

  // Wordmark.
  drawLogo(ctx, 64, 60, 36);
  ctx.fillStyle = "#ededef";
  ctx.font = `600 26px ${SANS}`;
  ctx.textBaseline = "middle";
  ctx.fillText("KeyHalo", 112, 79);
  ctx.fillStyle = "#71717a";
  ctx.font = `500 18px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillText(text.tagline, W - 64, 79);
  ctx.textAlign = "left";

  // Mode pill.
  ctx.font = `500 17px ${SANS}`;
  const pill = text.mode;
  const pw = ctx.measureText(pill).width + 28;
  ctx.fillStyle = "#18181b";
  roundRect(ctx, 64, 140, pw, 34, 17);
  ctx.fill();
  ctx.strokeStyle = "#2e2e33";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#a1a1aa";
  ctx.fillText(pill, 78, 158);

  // Big WPM.
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fafafa";
  ctx.font = `600 190px ${SANS}`;
  const big = String(Math.round(result.wpm));
  ctx.fillText(big, 56, 362);
  const bw = ctx.measureText(big).width;
  ctx.fillStyle = "#71717a";
  ctx.font = `500 34px ${SANS}`;
  ctx.fillText(text.wpm, 56 + bw + 16, 362);

  // Secondary stats.
  const stats: [string, string][] = [
    [text.accuracy, `${(result.accuracy * 100).toFixed(1)}%`],
    [text.consistency, `${Math.round(result.consistency * 100)}%`],
    [text.raw, `${Math.round(result.rawWpm)}`],
    [text.time, `${(result.durationMs / 1000).toFixed(result.durationMs < 10000 ? 1 : 0)}s`],
  ];
  stats.forEach(([label, value], i) => {
    const x = 64 + i * 128;
    ctx.fillStyle = "#71717a";
    ctx.font = `500 16px ${SANS}`;
    ctx.fillText(label, x, 440);
    ctx.fillStyle = "#ededef";
    ctx.font = `600 34px ${MONO}`;
    ctx.fillText(value, x, 484);
  });

  // Mini heatmap keyboard.
  const heat = keyHeat(result.keys, 1);
  const kbW = 520;
  const unit = kbW / input.size.w;
  const kbH = unit * input.size.h;
  const kx = W - 64 - kbW;
  const ky = 150 + (330 - kbH) / 2;
  ctx.fillStyle = "#0f0f12";
  roundRect(ctx, kx - 14, ky - 14, kbW + 28, kbH + 28, 16);
  ctx.fill();
  ctx.strokeStyle = "#1d1d21";
  ctx.stroke();
  for (const k of input.keys) {
    const x = kx + k.x * unit + 2;
    const y = ky + k.y * unit + 2;
    const w = (k.w ?? 1) * unit - 4;
    const h = (k.h ?? 1) * unit - 4;
    const v = heat[k.code];
    const c = v === undefined ? null : heatColor(v);
    ctx.fillStyle = c ? `rgb(${c[0]},${c[1]},${c[2]})` : "#1c1c20";
    roundRect(ctx, x, y, w, h, 5);
    ctx.fill();
    const label = input.labels?.[k.code] ?? k.label;
    if (label && label.length <= 2 && (k.w ?? 1) <= 1.25) {
      ctx.fillStyle = c && v! > 0.6 ? "rgba(9,9,11,0.75)" : "rgba(212,212,216,0.55)";
      ctx.font = `500 ${Math.round(unit * 0.3)}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + w / 2, y + h / 2 + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
  }
  // Legend under the keyboard: fast [gradient] slow / missed.
  const ly = ky + kbH + 40;
  ctx.fillStyle = "#62626b";
  ctx.font = `500 14px ${SANS}`;
  ctx.fillText("fast", kx, ly + 5);
  const gx = kx + 40;
  const grad = ctx.createLinearGradient(gx, 0, gx + 160, 0);
  [0, 0.25, 0.5, 0.75, 1].forEach((p) => {
    const c = heatColor(p);
    grad.addColorStop(p, `rgb(${c[0]},${c[1]},${c[2]})`);
  });
  ctx.fillStyle = grad;
  roundRect(ctx, gx, ly - 4, 160, 8, 4);
  ctx.fill();
  ctx.fillStyle = "#62626b";
  ctx.fillText("slow / missed", gx + 172, ly + 5);

  // Footer.
  ctx.strokeStyle = "#1d1d21";
  ctx.beginPath();
  ctx.moveTo(64, 540);
  ctx.lineTo(W - 64, 540);
  ctx.stroke();
  ctx.fillStyle = "#62626b";
  ctx.font = `500 17px ${SANS}`;
  ctx.fillText(text.date, 64, 578);
  ctx.textAlign = "right";
  ctx.fillText(`${result.chars} chars · ${result.errors} errors`, W - 64, 578);
  ctx.textAlign = "left";
  return canvas;
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, filename);
  }, "image/png");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
