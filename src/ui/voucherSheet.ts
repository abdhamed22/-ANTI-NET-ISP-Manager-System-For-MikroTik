import { base64ToBytes, buildPdf, type JpegPage } from '../core/pdf.ts';
import type { Voucher } from '../core/vouchers.ts';

export interface CardStyle {
  networkName: string;
  logo: string;
  userLabel: string;
  passLabel: string;
  rtl: boolean;
  priceOf: (profile: string) => string;
}

const W = 1240; // A4 at 150 dpi
const H = 1754;
const COLS = 3;
const ROWS = 8;
const MARGIN = 40;
const GAP = 16;
const PER_PAGE = COLS * ROWS;

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: number, family: string): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && s > 10) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${family}`;
  }
}

const SANS = 'system-ui, "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif';
const MONO = '"Roboto Mono", "DejaVu Sans Mono", monospace';

function drawCard(ctx: CanvasRenderingContext2D, v: Voucher, x: number, y: number, w: number, h: number, style: CardStyle, logo: HTMLImageElement | null) {
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  const pad = 14;
  const start = style.rtl ? x + w - pad : x + pad;
  const end = style.rtl ? x + pad : x + w - pad;
  ctx.direction = style.rtl ? 'rtl' : 'ltr';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#0f172a';

  let headerWidth = w - pad * 2;
  if (logo) {
    const lh = 38;
    const lw = Math.min(110, (logo.width / logo.height) * lh);
    const lx = style.rtl ? x + pad : x + w - pad - lw;
    ctx.drawImage(logo, lx, y + 10, lw, lh);
    headerWidth -= lw + 8;
  }
  fit(ctx, style.networkName, headerWidth, 26, 700, SANS);
  ctx.fillText(style.networkName, start, y + 40);

  const row = (label: string, value: string, top: number) => {
    ctx.fillStyle = '#475569';
    ctx.font = `500 18px ${SANS}`;
    ctx.direction = style.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'start';
    ctx.fillText(label, start, top);
    ctx.fillStyle = '#0f172a';
    ctx.direction = 'ltr';
    ctx.textAlign = style.rtl ? 'left' : 'right';
    fit(ctx, value, w * 0.62, 30, 700, MONO);
    ctx.fillText(value, end, top + 2);
  };
  row(style.userLabel, v.username, y + 92);
  row(style.passLabel, v.password, y + 136);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#334155';
  ctx.font = `600 18px ${SANS}`;
  ctx.fillText(v.profile, x + pad, y + h - 14);
  ctx.textAlign = 'right';
  ctx.fillText(style.priceOf(v.profile), x + w - pad, y + h - 14);
  ctx.restore();
}

/** Renders voucher cards into A4 pages and returns a PDF file. */
export async function vouchersToPdf(vouchers: Voucher[], style: CardStyle): Promise<Uint8Array> {
  const logo = await loadImage(style.logo);
  const cw = (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
  const ch = (H - MARGIN * 2 - GAP * (ROWS - 1)) / ROWS;
  const pages: JpegPage[] = [];
  for (let p = 0; p < vouchers.length; p += PER_PAGE) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    vouchers.slice(p, p + PER_PAGE).forEach((v, i) => {
      const col = i % COLS;
      const r = Math.floor(i / COLS);
      drawCard(ctx, v, MARGIN + col * (cw + GAP), MARGIN + r * (ch + GAP), cw, ch, style, logo);
    });
    const jpeg = base64ToBytes(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
    pages.push({ jpeg, width: W, height: H });
  }
  return buildPdf(pages);
}
