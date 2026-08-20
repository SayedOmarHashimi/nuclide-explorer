import type { Nuclide } from "./types";

/**
 * Decay-mode colours follow the convention used on published Segre charts, so
 * a physicist reading this recognises it immediately: black for stable, blue
 * for beta-minus, orange/red for the electron-capture side, yellow for alpha,
 * green for fission, violet for proton emission, cyan for neutron emission.
 * Inventing a prettier palette would make the chart harder to read for the
 * people most likely to look at it.
 */
export const DECAY_COLORS: Record<string, string> = {
  STABLE: "#e8e8ea",
  "B-": "#3b82f6",
  "2B-": "#1d4ed8",
  "B-N": "#60a5fa",
  "B-2N": "#93c5fd",
  "B-A": "#6366f1",
  "EC+B+": "#f97316",
  "B+": "#fb923c",
  EC: "#ea580c",
  "2EC": "#c2410c",
  "2B+": "#fdba74",
  ECP: "#f59e0b",
  "B+P": "#fbbf24",
  A: "#facc15",
  P: "#a855f7",
  "2P": "#c084fc",
  N: "#22d3ee",
  "2N": "#67e8f9",
  SF: "#22c55e",
  ECSF: "#4ade80",
  IT: "#94a3b8",
  UNKNOWN: "#3f3f46",
};

export const DECAY_LEGEND: { code: string; label: string }[] = [
  { code: "STABLE", label: "Stable" },
  { code: "B-", label: "β⁻" },
  { code: "EC+B+", label: "EC / β⁺" },
  { code: "A", label: "α" },
  { code: "P", label: "p" },
  { code: "N", label: "n" },
  { code: "SF", label: "Spont. fission" },
  { code: "UNKNOWN", label: "Unknown" },
];

/** Perceptually-ordered ramp for log10(half-life), cold = short, warm = long. */
const HALF_LIFE_STOPS: [number, [number, number, number]][] = [
  [-22, [40, 12, 62]],
  [-12, [78, 26, 122]],
  [-6, [130, 32, 120]],
  [-2, [186, 54, 85]],
  [2, [226, 104, 48]],
  [6, [242, 160, 40]],
  [12, [246, 214, 90]],
  [20, [214, 245, 168]],
  [30, [232, 255, 232]],
];

export function halfLifeColor(log10Seconds: number | null): string {
  if (log10Seconds === null) return DECAY_COLORS.UNKNOWN;
  const value = Math.max(-22, Math.min(30, log10Seconds));
  for (let i = 0; i < HALF_LIFE_STOPS.length - 1; i += 1) {
    const [x0, c0] = HALF_LIFE_STOPS[i]!;
    const [x1, c1] = HALF_LIFE_STOPS[i + 1]!;
    if (value <= x1) {
      const t = (value - x0) / (x1 - x0);
      const mix = c0.map((channel, k) => Math.round(channel + t * (c1[k]! - channel)));
      return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
    }
  }
  return `rgb(232, 255, 232)`;
}

export type ColorMode = "decay" | "halfLife";

export function colorFor(nuclide: Nuclide, mode: ColorMode): string {
  if (nuclide.stability === "stable") return DECAY_COLORS.STABLE!;
  if (mode === "decay") {
    const code = (nuclide.primary_decay_mode ?? "").toUpperCase();
    return DECAY_COLORS[code] ?? DECAY_COLORS.UNKNOWN!;
  }
  const log10 =
    nuclide.log10_half_life_seconds === null
      ? null
      : Number(nuclide.log10_half_life_seconds);
  return halfLifeColor(log10 === null || Number.isNaN(log10) ? null : log10);
}

/** Human-readable half-life, choosing a unit that keeps the number legible. */
export function formatHalfLife(nuclide: Nuclide): string {
  if (nuclide.stability === "stable") return "Stable";
  const seconds = nuclide.half_life_seconds;
  if (seconds === null) return "Unknown";

  const prefix = nuclide.half_life_is_limit
    ? { LT: "< ", LE: "≤ ", GT: "> ", GE: "≥ " }[nuclide.half_life_operator ?? ""] ?? ""
    : nuclide.half_life_operator === "AP"
      ? "≈ "
      : "";

  const units: [number, string][] = [
    [3.15576e16, "Gyr"],
    [3.15576e13, "Myr"],
    [3.15576e7, "yr"],
    [86400, "d"],
    [3600, "h"],
    [60, "min"],
    [1, "s"],
    [1e-3, "ms"],
    [1e-6, "µs"],
    [1e-9, "ns"],
    [1e-12, "ps"],
  ];
  for (const [factor, label] of units) {
    if (seconds >= factor) {
      const value = seconds / factor;
      return `${prefix}${value < 10 ? value.toPrecision(3) : value.toPrecision(4)} ${label}`;
    }
  }
  return `${prefix}${seconds.toExponential(3)} s`;
}
