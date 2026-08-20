"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import NuclideChart from "@/components/NuclideChart";
import Controls, { type Filters } from "@/components/Controls";
import DetailPanel from "@/components/DetailPanel";
import DecayChainView from "@/components/DecayChainView";
import type { ColorMode } from "@/lib/palette";
import type { ChainResponse, DecayMode, Nuclide } from "@/lib/types";

const EMPTY_FILTERS: Filters = {
  stability: "",
  decayMode: "",
  halfLifeLogMin: "",
  halfLifeLogMax: "",
};

export default function Home() {
  const [nuclides, setNuclides] = useState<Nuclide[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [colorMode, setColorMode] = useState<ColorMode>("decay");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ nuclide: Nuclide; decayModes: DecayMode[] } | null>(null);
  const [chain, setChain] = useState<ChainResponse | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

  // The full chart is fetched once. Filtering happens client-side because
  // 3,386 rows is small enough to hold in memory, and a round trip per
  // keystroke would make the controls feel sluggish. The API filters exist
  // regardless - they are what makes the endpoint useful to anyone else.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/nuclides?limit=5000")
      .then(async (response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return response.json();
      })
      .then((data: { nuclides: Nuclide[] }) => {
        if (!cancelled) setNuclides(data.nuclides);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/nuclides/${selectedId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/decay-chain/${selectedId}?maxDepth=30&minBranchingPct=0.1`).then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([detailData, chainData]) => {
        if (cancelled) return;
        setDetail(detailData);
        setChain(chainData);
      })
      .finally(() => {
        if (!cancelled) setChainLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/[\s-]/g, "");
    const min = filters.halfLifeLogMin === "" ? null : Number(filters.halfLifeLogMin);
    const max = filters.halfLifeLogMax === "" ? null : Number(filters.halfLifeLogMax);

    return nuclides.filter((nuclide) => {
      if (filters.stability && nuclide.stability !== filters.stability) return false;
      if (filters.decayMode && nuclide.primary_decay_mode !== filters.decayMode) return false;
      if (min !== null || max !== null) {
        const log10 =
          nuclide.log10_half_life_seconds === null
            ? null
            : Number(nuclide.log10_half_life_seconds);
        if (log10 === null || Number.isNaN(log10)) return false;
        if (min !== null && log10 < min) return false;
        if (max !== null && log10 > max) return false;
      }
      if (term) {
        const label = `${nuclide.element_symbol}${nuclide.mass_number}`.toLowerCase();
        if (!label.includes(term) && !nuclide.element_symbol.toLowerCase().startsWith(term)) {
          return false;
        }
      }
      return true;
    });
  }, [nuclides, filters, search]);

  const highlighted = useMemo(() => {
    if (!chain) return undefined;
    return new Set(chain.nodes.map((node) => node.nuclide_id));
  }, [chain]);

  // Clearing the previous nuclide here rather than inside the fetch effect
  // keeps the effect free of synchronous setState, which would otherwise
  // trigger a second render pass before the request even starts.
  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setDetail(null);
    setChain(null);
    setChainLoading(true);
  }, []);

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Nuclide Explorer
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Every known nuclide from the IAEA Livechart API, over ENSDF — the evaluated
            nuclear structure and decay database. Protons up, neutrons across. Click a
            cell to walk its decay chain to stability.
          </p>
        </div>
        <a
          href="https://github.com/SayedOmarHashimi/nuclide-explorer"
          className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-white/25 hover:text-zinc-100"
        >
          Source
        </a>
      </header>

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Could not load nuclide data: {loadError}. Check that the database is reachable
          and the dbt models have been built.
        </div>
      )}

      <Controls
        colorMode={colorMode}
        onColorMode={setColorMode}
        filters={filters}
        onFilters={setFilters}
        search={search}
        onSearch={setSearch}
        visibleCount={visible.length}
        totalCount={nuclides.length}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {loading ? (
            <div className="flex h-[520px] items-center justify-center rounded-xl border border-white/10 bg-zinc-950 text-sm text-zinc-500">
              Loading nuclide chart…
            </div>
          ) : (
            <NuclideChart
              nuclides={visible}
              colorMode={colorMode}
              selectedId={selectedId}
              highlightedIds={highlighted}
              onSelect={handleSelect}
            />
          )}
        </div>

        <aside className="rounded-xl border border-white/10 bg-zinc-900/50 p-4">
          {detail ? (
            <DetailPanel
              nuclide={detail.nuclide}
              decayModes={detail.decayModes}
              onSelect={handleSelect}
            />
          ) : (
            <div className="py-10 text-center text-sm text-zinc-500">
              Select a nuclide on the chart.
            </div>
          )}
        </aside>
      </div>

      {selectedId && (
        <section className="mt-8 rounded-xl border border-white/10 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
              Decay chain
            </h2>
            {chain && (
              <span className="font-mono text-[11px] text-zinc-500">
                {chain.nodeCount} nuclides · {chain.edgeCount} branches · ends at{" "}
                {chain.terminalNuclides.length} terminal
                {chain.terminalNuclides.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {chainLoading ? (
            <p className="py-8 text-center text-sm text-zinc-500">Walking chain…</p>
          ) : chain && chain.edges.length > 0 ? (
            <DecayChainView chain={chain} onSelect={handleSelect} />
          ) : (
            <p className="py-8 text-center text-sm text-zinc-500">
              No followable decay from here — this nuclide is stable, fissions into
              fragments, or its decay products are outside the dataset.
            </p>
          )}
        </section>
      )}

      <footer className="mt-10 border-t border-white/10 pt-5 text-xs text-zinc-600">
        Data: IAEA Nuclear Data Section, Livechart API (ENSDF). Half-lives are
        recomputed from the published value and unit rather than taken from the
        precomputed column; values marked with a bound are limits, not measurements.
      </footer>
    </main>
  );
}
