"use client";

import { DECAY_COLORS, formatHalfLife } from "@/lib/palette";
import { num, type DecayMode, type Nuclide } from "@/lib/types";

type Props = {
  nuclide: Nuclide;
  decayModes: DecayMode[];
  onSelect: (nuclideId: string) => void;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-mono text-zinc-200">{value}</dd>
    </>
  );
}

export default function DetailPanel({ nuclide, decayModes, onSelect }: Props) {
  const abundance = num(nuclide.natural_abundance_pct);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-zinc-50">
            {nuclide.element_symbol}
          </span>
          <span className="text-xl text-zinc-400">{nuclide.mass_number}</span>
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wide ${
              nuclide.stability === "stable"
                ? "bg-zinc-100/15 text-zinc-200"
                : nuclide.stability === "unknown"
                  ? "bg-zinc-700/40 text-zinc-400"
                  : "bg-sky-500/15 text-sky-300"
            }`}
          >
            {nuclide.stability}
          </span>
        </div>
        <p className="mt-1 font-mono text-xs text-zinc-500">
          Z = {nuclide.z} · N = {nuclide.n} · A = {nuclide.mass_number}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <Row label="Half-life" value={formatHalfLife(nuclide)} />
        {nuclide.half_life_is_limit && (
          <Row
            label="Note"
            value={
              <span className="text-amber-300">
                bound, not a measurement ({nuclide.half_life_operator})
              </span>
            }
          />
        )}
        <Row label="As published" value={
          nuclide.half_life_raw
            ? `${nuclide.half_life_raw}${nuclide.half_life_unit ? ` ${nuclide.half_life_unit}` : ""}`
            : null
        } />
        <Row label="Spin / parity" value={nuclide.spin_parity} />
        <Row
          label="Natural abundance"
          value={abundance !== null ? `${abundance}%` : null}
        />
        <Row label="Discovered" value={nuclide.discovery_year} />
      </dl>

      <div>
        <h3 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
          Decay branches
        </h3>
        {decayModes.length === 0 ? (
          <p className="text-xs text-zinc-500">
            {nuclide.stability === "stable"
              ? "None — this nuclide is stable."
              : "No decay mode recorded."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {decayModes.map((mode) => {
              const pct = num(mode.branching_pct);
              return (
                <li
                  key={mode.branch_index}
                  className="flex items-center gap-2 rounded-md border border-white/5 bg-zinc-950/60 px-2.5 py-1.5 text-xs"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: DECAY_COLORS[mode.mode_code.toUpperCase()] ?? "#71717a" }}
                  />
                  <span className="font-mono text-zinc-200">{mode.mode_code}</span>
                  <span className="truncate text-zinc-500">{mode.mode_label}</span>
                  <span className="ml-auto shrink-0 font-mono text-zinc-400">
                    {pct !== null ? `${pct}%` : "—"}
                  </span>
                  {mode.daughter_nuclide_id ? (
                    <button
                      onClick={() => onSelect(mode.daughter_nuclide_id!)}
                      className="shrink-0 rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[11px] text-sky-300 hover:bg-sky-500/20"
                    >
                      → {mode.daughter_element_symbol}-{mode.daughter_mass_number}
                    </button>
                  ) : (
                    <span
                      className="shrink-0 font-mono text-[11px] text-zinc-600"
                      title={
                        mode.is_fission
                          ? "Spontaneous fission produces a distribution of fragments, not one daughter."
                          : mode.is_terminal
                            ? "Isomeric transition leaves the nuclide unchanged."
                            : "Daughter is not in the dataset."
                      }
                    >
                      {mode.is_fission ? "fragments" : mode.is_terminal ? "same nuclide" : "—"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
