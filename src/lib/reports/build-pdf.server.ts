// Server-only PDF builder for the Paper → Live transition report.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type PaperReportData = {
  generatedAt: string; // ISO
  userEmail?: string | null;
  period: { from: string | null; to: string };
  capital: {
    initial: number;
    final: number;
    pnl: number;
    pnlPct: number;
    maxDrawdownPct: number;
  };
  trades: {
    total: number;
    wins: number;
    losses: number;
    winRatePct: number;
    avgWinPct: number;
    avgLossPct: number;
    bestTradePct: number;
    worstTradePct: number;
    avgHoldHours: number;
  };
  byAsset: Array<{
    asset: string;
    trades: number;
    pnl: number;
    winRatePct: number;
  }>;
  equityCurve: Array<{ ts: string; total: number }>;
  settings: {
    timeframe: string;
    maxPositions: number;
    maxPositionPct: number;
    stopLossPct: number;
    trailingActivatePct: number;
    trailingGapPct: number;
    takeProfitPct: number;
    dailyLossLimitPct: number;
    enabledSentimentSources: Record<string, boolean>;
    sentimentWeights: Record<string, number>;
  };
};

const COLORS = {
  text: rgb(0.08, 0.09, 0.12),
  muted: rgb(0.45, 0.48, 0.55),
  border: rgb(0.86, 0.88, 0.92),
  accent: rgb(0.36, 0.42, 0.95),
  good: rgb(0.12, 0.68, 0.4),
  bad: rgb(0.85, 0.25, 0.3),
  bg: rgb(0.98, 0.98, 0.99),
};

function fmtUsd(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}
function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export async function buildPaperReportPdf(data: PaperReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  // Header
  page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: COLORS.accent });
  page.drawText("Crypto Bot — Report Fase Paper", {
    x: 40, y: height - 50, size: 22, font: fontB, color: rgb(1, 1, 1),
  });
  page.drawText("Resoconto operativo prima del passaggio a Live", {
    x: 40, y: height - 72, size: 11, font, color: rgb(0.92, 0.93, 1),
  });

  let y = height - 120;

  // Meta
  const metaLine = `Generato il ${new Date(data.generatedAt).toLocaleString("it-IT")}`;
  page.drawText(metaLine, { x: 40, y, size: 9, font, color: COLORS.muted });
  if (data.userEmail) {
    page.drawText(data.userEmail, { x: width - 40 - font.widthOfTextAtSize(data.userEmail, 9), y, size: 9, font, color: COLORS.muted });
  }
  y -= 8;
  const periodLine = `Periodo: ${data.period.from ? new Date(data.period.from).toLocaleDateString("it-IT") : "—"} → ${new Date(data.period.to).toLocaleDateString("it-IT")}`;
  page.drawText(periodLine, { x: 40, y, size: 9, font, color: COLORS.muted });

  y -= 24;

  // KPI cards
  const kpis: Array<[string, string, "good" | "bad" | "neutral"]> = [
    ["Capitale iniziale", fmtUsd(data.capital.initial), "neutral"],
    ["Capitale finale", fmtUsd(data.capital.final), data.capital.final >= data.capital.initial ? "good" : "bad"],
    ["P&L totale", `${fmtUsd(data.capital.pnl)} (${fmtPct(data.capital.pnlPct)})`, data.capital.pnl >= 0 ? "good" : "bad"],
    ["Max drawdown", fmtPct(-Math.abs(data.capital.maxDrawdownPct)), "bad"],
  ];
  y = drawKpiRow(page, font, fontB, 40, y, width - 80, kpis);

  y -= 20;

  // Trades section
  y = drawSectionTitle(page, fontB, 40, y, "Statistiche Trade");
  const tradeRows: Array<[string, string]> = [
    ["Trade totali", String(data.trades.total)],
    ["Vincenti / Perdenti", `${data.trades.wins} / ${data.trades.losses}`],
    ["Win rate", `${data.trades.winRatePct.toFixed(1)}%`],
    ["Guadagno medio (winner)", fmtPct(data.trades.avgWinPct)],
    ["Perdita media (loser)", fmtPct(data.trades.avgLossPct)],
    ["Miglior trade", fmtPct(data.trades.bestTradePct)],
    ["Peggior trade", fmtPct(data.trades.worstTradePct)],
    ["Durata media", `${data.trades.avgHoldHours.toFixed(1)} h`],
  ];
  y = drawTwoColTable(page, font, fontB, 40, y, width - 80, tradeRows);

  y -= 20;

  // Equity curve
  y = drawSectionTitle(page, fontB, 40, y, "Curva Equity");
  y = drawEquityCurve(page, font, 40, y, width - 80, 140, data.equityCurve);

  y -= 20;

  // By asset
  if (data.byAsset.length > 0) {
    y = drawSectionTitle(page, fontB, 40, y, "Performance per Asset");
    y = drawAssetTable(page, font, fontB, 40, y, width - 80, data.byAsset);
    y -= 20;
  }

  // Page 2: parameters
  const page2 = pdf.addPage([595, 842]);
  let y2 = page2.getHeight() - 60;
  y2 = drawSectionTitle(page2, fontB, 40, y2, "Parametri usati in Paper");
  const s = data.settings;
  const paramRows: Array<[string, string]> = [
    ["Timeframe", s.timeframe],
    ["Max posizioni contemporanee", String(s.maxPositions)],
    ["Size max per posizione", `${s.maxPositionPct}%`],
    ["Stop loss", `${s.stopLossPct}%`],
    ["Trailing — attivazione", `${s.trailingActivatePct}%`],
    ["Trailing — gap", `${s.trailingGapPct}%`],
    ["Take profit", `${s.takeProfitPct}%`],
    ["Limite perdita giornaliera", `${s.dailyLossLimitPct}%`],
  ];
  y2 = drawTwoColTable(page2, font, fontB, 40, y2, page2.getWidth() - 80, paramRows);
  y2 -= 20;

  y2 = drawSectionTitle(page2, fontB, 40, y2, "Fonti Sentiment");
  const sentRows: Array<[string, string]> = Object.entries(s.enabledSentimentSources).map(([k, v]) => [
    k,
    `${v ? "attiva" : "spenta"} · peso ${s.sentimentWeights[k] ?? 0}`,
  ]);
  y2 = drawTwoColTable(page2, font, fontB, 40, y2, page2.getWidth() - 80, sentRows);

  // Footer (both pages)
  for (const p of pdf.getPages()) {
    p.drawText("Crypto Bot · Report Paper · riservato", {
      x: 40, y: 24, size: 8, font, color: COLORS.muted,
    });
    p.drawText(`pag. ${pdf.getPages().indexOf(p) + 1}/${pdf.getPages().length}`, {
      x: p.getWidth() - 60, y: 24, size: 8, font, color: COLORS.muted,
    });
  }

  return await pdf.save();
}

function drawSectionTitle(page: PDFPage, fontB: PDFFont, x: number, y: number, label: string) {
  page.drawText(label, { x, y, size: 13, font: fontB, color: COLORS.text });
  page.drawLine({ start: { x, y: y - 4 }, end: { x: x + 80, y: y - 4 }, thickness: 2, color: COLORS.accent });
  return y - 20;
}

function drawKpiRow(
  page: PDFPage, font: PDFFont, fontB: PDFFont,
  x: number, y: number, w: number,
  kpis: Array<[string, string, "good" | "bad" | "neutral"]>,
) {
  const gap = 10;
  const cardW = (w - gap * (kpis.length - 1)) / kpis.length;
  const cardH = 60;
  kpis.forEach(([label, value, kind], i) => {
    const cx = x + i * (cardW + gap);
    page.drawRectangle({ x: cx, y: y - cardH, width: cardW, height: cardH, color: COLORS.bg, borderColor: COLORS.border, borderWidth: 1 });
    page.drawText(label, { x: cx + 10, y: y - 18, size: 8, font, color: COLORS.muted });
    const color = kind === "good" ? COLORS.good : kind === "bad" ? COLORS.bad : COLORS.text;
    page.drawText(value, { x: cx + 10, y: y - 42, size: 13, font: fontB, color });
  });
  return y - cardH;
}

function drawTwoColTable(
  page: PDFPage, font: PDFFont, fontB: PDFFont,
  x: number, y: number, w: number,
  rows: Array<[string, string]>,
) {
  const rowH = 18;
  rows.forEach(([k, v], i) => {
    const ry = y - i * rowH;
    if (i % 2 === 0) {
      page.drawRectangle({ x, y: ry - rowH + 4, width: w, height: rowH, color: COLORS.bg });
    }
    page.drawText(k, { x: x + 8, y: ry - 12, size: 9, font, color: COLORS.muted });
    const valW = fontB.widthOfTextAtSize(v, 9);
    page.drawText(v, { x: x + w - 8 - valW, y: ry - 12, size: 9, font: fontB, color: COLORS.text });
  });
  return y - rows.length * rowH;
}

function drawAssetTable(
  page: PDFPage, font: PDFFont, fontB: PDFFont,
  x: number, y: number, w: number,
  rows: PaperReportData["byAsset"],
) {
  const colX = [x + 8, x + 150, x + 280, x + 400];
  page.drawText("Asset", { x: colX[0], y, size: 9, font: fontB, color: COLORS.muted });
  page.drawText("Trade", { x: colX[1], y, size: 9, font: fontB, color: COLORS.muted });
  page.drawText("P&L", { x: colX[2], y, size: 9, font: fontB, color: COLORS.muted });
  page.drawText("Win %", { x: colX[3], y, size: 9, font: fontB, color: COLORS.muted });
  y -= 6;
  page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.5, color: COLORS.border });
  const rowH = 16;
  rows.forEach((r, i) => {
    const ry = y - 12 - i * rowH;
    if (i % 2 === 0) {
      page.drawRectangle({ x, y: ry - 4, width: w, height: rowH, color: COLORS.bg });
    }
    page.drawText(r.asset, { x: colX[0], y: ry, size: 9, font, color: COLORS.text });
    page.drawText(String(r.trades), { x: colX[1], y: ry, size: 9, font, color: COLORS.text });
    page.drawText(fmtUsd(r.pnl), { x: colX[2], y: ry, size: 9, font, color: r.pnl >= 0 ? COLORS.good : COLORS.bad });
    page.drawText(`${r.winRatePct.toFixed(0)}%`, { x: colX[3], y: ry, size: 9, font, color: COLORS.text });
  });
  return y - 12 - rows.length * rowH;
}

function drawEquityCurve(
  page: PDFPage, font: PDFFont,
  x: number, y: number, w: number, h: number,
  points: Array<{ ts: string; total: number }>,
) {
  // Frame
  page.drawRectangle({ x, y: y - h, width: w, height: h, color: COLORS.bg, borderColor: COLORS.border, borderWidth: 1 });
  if (points.length < 2) {
    page.drawText("Dati insufficienti", { x: x + w / 2 - 40, y: y - h / 2, size: 10, font, color: COLORS.muted });
    return y - h;
  }
  const ys = points.map((p) => p.total);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = max - min || 1;
  const pad = 12;
  const px = (i: number) => x + pad + (i / (points.length - 1)) * (w - 2 * pad);
  const py = (v: number) => y - h + pad + ((v - min) / range) * (h - 2 * pad);

  // Polyline
  for (let i = 1; i < points.length; i++) {
    page.drawLine({
      start: { x: px(i - 1), y: py(points[i - 1].total) },
      end: { x: px(i), y: py(points[i].total) },
      thickness: 1.3,
      color: COLORS.accent,
    });
  }
  // Axis labels
  page.drawText(fmtUsd(max), { x: x + 4, y: y - 10, size: 7, font, color: COLORS.muted });
  page.drawText(fmtUsd(min), { x: x + 4, y: y - h + 4, size: 7, font, color: COLORS.muted });
  return y - h;
}
