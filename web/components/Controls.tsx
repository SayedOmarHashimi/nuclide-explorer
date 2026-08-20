"use client";

import { DECAY_COLORS, DECAY_LEGEND, halfLifeColor, type ColorMode } from "@/lib/palette";

export type Filters = {
  stability: "" | "stable" | "unstable" | "unknown";
  decayMode: string;
  halfLifeLogMin: string;
  halfLifeLogMax: string;
};

type Props = {
  colorMode: ColorMode;
  onColorMode: (mode: ColorMode) => void;
  filters: Filters;
  onFilters: (filters: Filters) => void;
  search: string;
  onSearch: (value: string) => void;
  visibleCount: number;
  totalCount: number;
};

const MODE_OPTIONS = ["B-", "EC+B+", "EC", "B+", "A", "P", "N", "SF", "IT", "2B-"];

export default function Controls({
  colorMode,
  onColorMode,
  filters,
  onFilters,
  search,
  onSearch,
  visibleCount,
  totalCount,
}: Props) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onFilters({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-white/10 bg-zinc-900/50 p-4">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">Search</span>
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="U-238, Cs137, Tc"
          className="w-40 rounded-md border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500/60"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">Colour by</span>
        <div className="flex overflow-hidden rounded-md border border-white/10">
          {(["decay", "halfLife"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onColorMode(mode)}
              className={`px-3 py-1.5 text-sm transition ${
                colorMode === mode
                  ? "bg-sky-500/20 text-sky-200"
                  : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {mode === "decay" ? "Decay mode" : "Half-life"}
            </button>
          ))}
        </div>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">Stability</span>
        <select
          value={filters.stability}
          onChange={(event) => set("stability", event.target.value as Filters["stability"])}
          className="rounded-md border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500/60"
        >
          <option value="">All</option>
          <option value="stable">Stable</option>
          <option value="unstable">Unstable</option>
          <option value="unknown">Unknown</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">Decay mode</span>
        <select
          value={filters.decayMode}
          onChange={(event) => set("decayMode", event.target.value)}
          className="rounded-md border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500/60"
        >
          <option value="">Any</option>
          {MODE_OPTIONS.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span
          className="text-[11px] uppercase tracking-wider text-zinc-500"
          title="Half-lives span 1e-22 to 1e30 seconds, so the filter is logarithmic."
        >
          log₁₀ half-life (s)
        </span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={filters.halfLifeLogMin}
            onChange={(event) => set("halfLifeLogMin", event.target.value)}
            placeholder="−22"
            className="w-20 rounded-md border border-white/10 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500/60"
          />
          <span className="text-zinc-600">to</span>
          <input
            type="number"
            value={filters.halfLifeLogMax}
            onChange={(event) => set("halfLifeLogMax", event.target.value)}
            placeholder="30"
            className="w-20 rounded-md border border-white/10 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500/60"
          />
        </div>
      </label>

      <div className="ml-auto flex flex-col items-end gap-1.5">
        <span className="font-mono text-[11px] text-zinc-500">
          {visibleCount.toLocaleString()} / {totalCount.toLocaleString()} shown
        </span>
        {colorMode === "decay" ? (
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
            {DECAY_LEGEND.map((item) => (
              <span key={item.code} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: DECAY_COLORS[item.code] }}
                />
                {item.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500">1 ys</span>
            <div
              className="h-2.5 w-40 rounded-sm"
              style={{
                background: `linear-gradient(to right, ${[-22, -12, -6, -2, 2, 6, 12, 20, 30]
                  .map((stop) => halfLifeColor(stop))
                  .join(", ")})`,
              }}
            />
            <span className="text-[11px] text-zinc-500">1 Gyr+</span>
          </div>
        )}
      </div>
    </div>
  );
}
