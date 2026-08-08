import { AggregatedCandle, ChartRenderOptions } from "../config/types.js";
import { createCanvas } from "canvas";

// ============================================================
// CHART RENDERER
// Draws a pixel-perfect M5 candlestick chart as a PNG buffer
// exactly as a trader would see it on their screen.
// Uses Node.js 'canvas' package (HTML5 Canvas API, no browser needed).
// ============================================================

// Canvas dimensions
const W = 1200;
const H = 700;
const PADDING_LEFT = 70;
const PADDING_RIGHT = 80;
const PADDING_TOP = 60;
const PADDING_BOTTOM = 60;
const CHART_W = W - PADDING_LEFT - PADDING_RIGHT;
const CHART_H = H - PADDING_TOP - PADDING_BOTTOM;

// Colors — professional dark theme like TradingView
const BG_COLOR = "#131722";
const GRID_COLOR = "#1e2535";
const TEXT_COLOR = "#d1d4dc";
const BULL_COLOR = "#26a69a"; // Green candles
const BEAR_COLOR = "#ef5350"; // Red candles
const BULL_WICK = "#26a69a";
const BEAR_WICK = "#ef5350";
const EMA_COLOR = "#2196f3"; // Blue EMA line
const PREV_HIGH_COLOR = "#ff6b6b"; // Red horizontal line - prev day high
const PREV_LOW_COLOR = "#69f0ae"; // Green horizontal line - prev day low
const SESSION_COLOR = "rgba(255, 152, 0, 0.07)"; // Orange session shade
const LABEL_BG = "#1e2535";
export function renderChart(opts: ChartRenderOptions): Buffer {
  if (!opts.candles || opts.candles.length < 2) {
    throw new Error(
      "ChartRenderer: candles array must contain at least 2 elements.",
    );
  }

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const {
    candles,
    emaValues,
    prevDayHigh,
    prevDayLow,
    currentDayHigh,
    currentDayLow,
    setupType,
    pair,
    sessionName,
    sessionStartIdx,
    sessionEndIdx,
    orbHigh,
    orbLow,
    chartType,
  } = opts;
  const n = candles.length;

  const getDigitsForSymbol = (symbol: string): number => {
    const p = symbol.toUpperCase();
    if (p.includes("JPY")) return 3;
    if (
      p.includes("XAU") ||
      p.includes("GOLD") ||
      p.includes("NAS") ||
      p.includes("US30") ||
      p.includes("SPX") ||
      p.includes("GER40")
    )
      return 2;
    return 5;
  };
  const digits = getDigitsForSymbol(pair);

  // ── Find price range (with padding) ──────────────────────────
  let minPrice = Infinity,
    maxPrice = -Infinity;
  for (const c of candles) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }
  // Fix: Divide-by-Zero Crash if chart is completely flat
  if (maxPrice === minPrice) {
    maxPrice += 0.001;
    minPrice -= 0.001;
  }

  // Do NOT force min/max to include PDH/PDL if they are far away.
  // This was causing the 80-candle window to become squashed and unreadable!
  const priceRange = maxPrice - minPrice;
  const pricePad = priceRange * 0.08;
  const pMin = minPrice - pricePad;
  const pMax = maxPrice + pricePad;

  // Leave bottom 15% for volume histogram
  const PRICE_H = CHART_H * 0.85;
  const VOL_H = CHART_H * 0.15;

  const priceToY = (p: number) =>
    PADDING_TOP + PRICE_H - ((p - pMin) / (pMax - pMin)) * PRICE_H;
  const idxToX = (i: number) => PADDING_LEFT + (i / (n - 1)) * CHART_W;

  // ── Background ────────────────────────────────────────────────
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);

  // ── Draw ORB Lines if provided ──────────────────────
  if (orbHigh !== undefined && orbLow !== undefined) {
    const yHigh = priceToY(orbHigh);
    const yLow = priceToY(orbLow);

    // Draw ORB High Line
    ctx.beginPath();
    ctx.strokeStyle = "#e040fb"; // Bright purple for ORB
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.moveTo(PADDING_LEFT, yHigh);
    ctx.lineTo(W - PADDING_RIGHT, yHigh);
    ctx.stroke();

    // Draw ORB Low Line
    ctx.beginPath();
    ctx.moveTo(PADDING_LEFT, yLow);
    ctx.lineTo(W - PADDING_RIGHT, yLow);
    ctx.stroke();
    ctx.setLineDash([]); // Reset

    // Labels
    ctx.fillStyle = "#e040fb";
    ctx.font = '12px "Courier New"';
    ctx.fillText(`ORB HIGH: ${orbHigh.toFixed(digits)}`, 10, yHigh + 4);
    ctx.fillText(`ORB LOW: ${orbLow.toFixed(digits)}`, 10, yLow + 4);
  }

  // ── Grid lines ────────────────────────────────────────────────
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  const gridCount = 8;
  for (let g = 0; g <= gridCount; g++) {
    const y = PADDING_TOP + (g / gridCount) * PRICE_H;
    ctx.beginPath();
    ctx.moveTo(PADDING_LEFT, y);
    ctx.lineTo(PADDING_LEFT + CHART_W, y);
    ctx.stroke();
    // Price label
    const price = pMax - (g / gridCount) * (pMax - pMin);
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    ctx.fillText(price.toFixed(digits), PADDING_LEFT - 5, y + 4);
  }

  // Volume separator line
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.beginPath();
  ctx.moveTo(PADDING_LEFT, PADDING_TOP + PRICE_H);
  ctx.lineTo(PADDING_LEFT + CHART_W, PADDING_TOP + PRICE_H);
  ctx.stroke();

  // ── Session shading ───────────────────────────────────────────
  if (
    sessionStartIdx >= 0 &&
    sessionEndIdx >= 0 &&
    sessionEndIdx > sessionStartIdx
  ) {
    const sx = idxToX(sessionStartIdx);
    const ex = idxToX(Math.min(sessionEndIdx, n - 1));
    ctx.fillStyle = SESSION_COLOR;
    ctx.fillRect(sx, PADDING_TOP, ex - sx, CHART_H);
  }

  // ── Previous Day High/Low horizontal lines ────────────────────
  const drawHorizontal = (price: number, color: string, label: string) => {
    let y = priceToY(price);
    let isOffscreen = false;

    // Clamp to screen edges if off-screen so the AI still sees the label and direction
    if (y < PADDING_TOP) {
      y = PADDING_TOP;
      isOffscreen = true;
    } else if (y > PADDING_TOP + PRICE_H) {
      y = PADDING_TOP + PRICE_H;
      isOffscreen = true;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = isOffscreen ? 3 : 1.5;
    ctx.setLineDash(isOffscreen ? [] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(PADDING_LEFT, y);
    ctx.lineTo(PADDING_LEFT + CHART_W, y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Label
    ctx.fillStyle = color;
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "left";
    ctx.fillText(
      `${label}: ${price.toFixed(digits)}`,
      PADDING_LEFT + CHART_W + 5,
      y + 4,
    );
  };

  if (prevDayHigh && prevDayHigh > 0)
    drawHorizontal(prevDayHigh, PREV_HIGH_COLOR, "PDH");
  if (prevDayLow && prevDayLow > 0)
    drawHorizontal(prevDayLow, PREV_LOW_COLOR, "PDL");
  if (currentDayHigh && currentDayHigh > 0 && currentDayHigh !== prevDayHigh)
    drawHorizontal(currentDayHigh, "#ff9800", "CDH");
  if (currentDayLow && currentDayLow > 0 && currentDayLow !== prevDayLow)
    drawHorizontal(currentDayLow, "#00bcd4", "CDL");

  // ── Candlesticks & Volume ─────────────────────────────────────
  const candleW = Math.max(2, (CHART_W / n) * 0.6);

  // Find max volume for scaling
  let maxVolume = 0;
  for (const c of candles) {
    const vol = c.volume || c.tickVolume || 0;
    if (vol > maxVolume) maxVolume = vol;
  }
  if (maxVolume === 0) maxVolume = 1;

  // Draw Volume Histogram first so it's in the background
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const x = idxToX(i);
    const vol = c.volume || c.tickVolume || 0;
    const isBull = c.close >= c.open;

    const vHeight = (vol / maxVolume) * VOL_H;
    const vY = PADDING_TOP + CHART_H - vHeight;

    // Bright opacity for volume to make it clearly visible
    ctx.fillStyle = isBull
      ? "rgba(38, 166, 154, 0.6)"
      : "rgba(239, 83, 80, 0.6)";
    ctx.fillRect(x - candleW / 2, vY, candleW, vHeight);
  }

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const x = idxToX(i);
    const isBull = c.close >= c.open;
    const bodyColor = isBull ? BULL_COLOR : BEAR_COLOR;
    const wickColor = isBull ? BULL_WICK : BEAR_WICK;

    const openY = priceToY(c.open);
    const closeY = priceToY(c.close);
    const highY = priceToY(c.high);
    const lowY = priceToY(c.low);

    const bodyTop = Math.min(openY, closeY);
    const bodyH = Math.max(1, Math.abs(openY - closeY));

    // Wick
    ctx.strokeStyle = wickColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    // Body
    ctx.fillStyle = bodyColor;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  }

  // ── AI Vision Trap Bounding Box ───────────────────────────────
  // We draw a prominent box around the last 4 candles (the trap zone)
  if (opts.drawTrapBox !== false && n > 4) {
    const boxStartIdx = n - 5;
    const boxEndIdx = n - 1;
    const startX = idxToX(boxStartIdx) - candleW;
    const endX = idxToX(boxEndIdx) + candleW;

    // Find min/max price in this specific 4-candle window
    let trapHigh = -Infinity;
    let trapLow = Infinity;
    for (let i = boxStartIdx; i <= boxEndIdx; i++) {
      if (candles[i].high > trapHigh) trapHigh = candles[i].high;
      if (candles[i].low < trapLow) trapLow = candles[i].low;
    }

    const trapHighY = priceToY(trapHigh) - 10;
    const trapLowY = priceToY(trapLow) + 10;
    const boxWidth = endX - startX;
    const boxHeight = trapLowY - trapHighY;

    ctx.strokeStyle = "rgba(255, 255, 0, 0.8)"; // Bright yellow box
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(startX, trapHighY, boxWidth, boxHeight);
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255, 255, 0, 0.15)";
    ctx.fillRect(startX, trapHighY, boxWidth, boxHeight);

    ctx.fillStyle = "rgba(255, 255, 0, 0.9)";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TRAP EVALUATION ZONE", startX + boxWidth / 2, trapHighY - 10);
  }

  // ── 20 EMA line ───────────────────────────────────────────────
  ctx.strokeStyle = EMA_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  let emaStarted = false;
  for (let i = 0; i < n; i++) {
    if (!emaValues[i] || isNaN(emaValues[i])) continue;
    const x = idxToX(i);
    const y = priceToY(emaValues[i]);
    if (!emaStarted) {
      ctx.moveTo(x, y);
      emaStarted = true;
    } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ── Title and labels ──────────────────────────────────────────
  let defaultSetupLabel = "";
  let defaultSetupColor = TEXT_COLOR;

  if (setupType === "FRD") {
    defaultSetupLabel = "🔴 FIRST RED DAY — SELL BIAS";
    defaultSetupColor = BEAR_COLOR;
  } else if (setupType === "FGD") {
    defaultSetupLabel = "🟢 FIRST GREEN DAY — BUY BIAS";
    defaultSetupColor = BULL_COLOR;
  } else if (setupType === "DAY3_LONG") {
    defaultSetupLabel = "🔴 DAY 3 BREAKOUT — REVERSAL SELL BIAS";
    defaultSetupColor = BEAR_COLOR;
  } else if (setupType === "DAY3_SHORT") {
    defaultSetupLabel = "🟢 DAY 3 BREAKOUT — REVERSAL BUY BIAS";
    defaultSetupColor = BULL_COLOR;
  } else if (setupType === "INSIDE_DAY") {
    defaultSetupLabel = "🟣 INSIDE DAY FALSE BREAK";
    defaultSetupColor = TEXT_COLOR;
  } else if (setupType === "LHF_LONG") {
    defaultSetupLabel = "🟢 TREND CONTINUATION — BUY BIAS";
    defaultSetupColor = BULL_COLOR;
  } else if (setupType === "LHF_SHORT") {
    defaultSetupLabel = "🔴 TREND CONTINUATION — SELL BIAS";
    defaultSetupColor = BEAR_COLOR;
  } else {
    defaultSetupLabel = setupType;
  }

  const finalTitle = opts.mainTitle || defaultSetupLabel;
  const finalTimeframe = opts.timeframe || "M5";

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${pair} ${finalTimeframe}`, PADDING_LEFT, 35);

  // If we provided a custom title, use text color instead of default red/green
  ctx.fillStyle = opts.mainTitle ? TEXT_COLOR : defaultSetupColor;
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(finalTitle, W / 2, 35);

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`Session: ${sessionName}`, W - PADDING_RIGHT, 35);

  // EMA label
  ctx.fillStyle = EMA_COLOR;
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "left";
  ctx.fillText("EMA 20", PADDING_LEFT + 5, PADDING_TOP + 15);

  // ── Chart border ──────────────────────────────────────────────
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(PADDING_LEFT, PADDING_TOP, CHART_W, CHART_H);

  return canvas.toBuffer("image/png");
}

/**
 * Determine which candles to include in the chart.
 * Shows the last `windowBars` M5 candles ending at index `currentIdx`.
 */
export function getChartWindow(
  allCandles: AggregatedCandle[],
  currentIdx: number,
  windowBars = 100, // Show last ~8 hours of M5 data
): { candles: AggregatedCandle[]; startIdx: number } {
  const startIdx = Math.max(0, currentIdx - windowBars + 1);
  return {
    candles: allCandles.slice(startIdx, currentIdx + 1),
    startIdx,
  };
}
