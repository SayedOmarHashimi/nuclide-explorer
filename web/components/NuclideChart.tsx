"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import { colorFor, formatHalfLife, type ColorMode } from "@/lib/palette";
import type { Nuclide } from "@/lib/types";

/**
 * The Segre chart: neutrons across, protons up, one cell per nuclide.
 *
 * Rendered to a canvas rather than to SVG or a generic charting library.
 * 3,386 nuclides means 3,386 DOM nodes in an SVG, and re-styling them on every
 * zoom frame is where libraries like Chart.js fall over. A single canvas
 * redraws the whole chart in one pass and stays at 60fps while panning.
 *
 * d3-zoom handles the pan/zoom maths only; it never touches the DOM here. The
 * transform it produces is applied manually inside the draw loop.
 */

const MAGIC_NUMBERS = [2, 8, 20, 28, 50, 82, 126];

type Props = {
  nuclides: Nuclide[];
  colorMode: ColorMode;
  selectedId: string | null;
  highlightedIds?: Set<string>;
  onSelect: (nuclideId: string) => void;
};

type Hover = { nuclide: Nuclide; x: number; y: number } | null;

export default function NuclideChart({
  nuclides,
  colorMode,
  selectedId,
  highlightedIds,
  onSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const [size, setSize] = useState({ width: 960, height: 560 });
  const [hover, setHover] = useState<Hover>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const bounds = useMemo(() => {
    let maxZ = 1;
    let maxN = 1;
    for (const nuclide of nuclides) {
      if (nuclide.z > maxZ) maxZ = nuclide.z;
      if (nuclide.n > maxN) maxN = nuclide.n;
    }
    return { maxZ: maxZ + 1, maxN: maxN + 1 };
  }, [nuclides]);

  // Cell size in world units, chosen so the whole chart just fits unzoomed.
  const baseCell = useMemo(() => {
    const padding = 44;
    return Math.min(
      (size.width - padding) / bounds.maxN,
      (size.height - padding) / bounds.maxZ,
    );
  }, [size, bounds]);

  const index = useMemo(() => {
    const map = new Map<string, Nuclide>();
    for (const nuclide of nuclides) map.set(`${nuclide.z}:${nuclide.n}`, nuclide);
    return map;
  }, [nuclides]);

  const worldOf = useCallback(
    (nuclide: Nuclide) => ({
      x: nuclide.n * baseCell,
      y: (bounds.maxZ - nuclide.z - 1) * baseCell,
    }),
    [baseCell, bounds.maxZ],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    const t = transformRef.current;
    const cell = baseCell * t.k;

    // Magic-number guides: closed nucleon shells, where nuclei are unusually
    // bound. They are the structural landmarks of this chart.
    context.strokeStyle = "rgba(148, 163, 184, 0.18)";
    context.lineWidth = 1;
    context.font = "10px ui-monospace, monospace";
    context.fillStyle = "rgba(148, 163, 184, 0.55)";
    // Below ~18px of separation the labels collide into each other ("N=2N=8"),
    // so the guide line is still drawn but its label is dropped.
    const labelSpacing = baseCell * t.k;
    for (const [i, magic] of MAGIC_NUMBERS.entries()) {
      const previous = MAGIC_NUMBERS[i - 1] ?? -Infinity;
      const labelled = (magic - previous) * labelSpacing >= 34;
      if (magic <= bounds.maxN) {
        const x = t.applyX(magic * baseCell);
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, size.height);
        context.stroke();
        if (labelled) context.fillText(`N=${magic}`, x + 3, size.height - 6);
      }
      if (magic <= bounds.maxZ) {
        const y = t.applyY((bounds.maxZ - magic - 1) * baseCell) + cell;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(size.width, y);
        context.stroke();
        if (labelled) context.fillText(`Z=${magic}`, 4, y - 4);
      }
    }

    const gap = cell > 5 ? 1 : 0;
    const showLabels = cell >= 22;
    const dimOthers = Boolean(highlightedIds && highlightedIds.size > 0);

    for (const nuclide of nuclides) {
      const { x: wx, y: wy } = worldOf(nuclide);
      const x = t.applyX(wx);
      const y = t.applyY(wy);
      if (x + cell < 0 || x > size.width || y + cell < 0 || y > size.height) continue;

      const isHighlighted = highlightedIds?.has(nuclide.nuclide_id) ?? false;
      context.globalAlpha = dimOthers && !isHighlighted ? 0.18 : 1;
      context.fillStyle = colorFor(nuclide, colorMode);
      context.fillRect(x, y, Math.max(1, cell - gap), Math.max(1, cell - gap));

      if (showLabels) {
        context.globalAlpha = dimOthers && !isHighlighted ? 0.2 : 0.92;
        context.fillStyle = "rgba(9, 9, 11, 0.82)";
        context.font = `${Math.min(11, cell / 2.6)}px ui-sans-serif, system-ui`;
        context.fillText(
          `${nuclide.element_symbol}${nuclide.mass_number}`,
          x + 3,
          y + cell / 2 + 3,
        );
      }
    }
    context.globalAlpha = 1;

    if (selectedId) {
      const target = nuclides.find((item) => item.nuclide_id === selectedId);
      if (target) {
        const { x: wx, y: wy } = worldOf(target);
        context.strokeStyle = "#ffffff";
        context.lineWidth = 2;
        context.strokeRect(
          t.applyX(wx) - 1.5,
          t.applyY(wy) - 1.5,
          cell + 2,
          cell + 2,
        );
      }
    }
  }, [nuclides, size, baseCell, bounds, colorMode, selectedId, highlightedIds, worldOf]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width } = entry.contentRect;
      setSize({ width, height: Math.max(420, Math.round(width * 0.58)) });
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const behaviour = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, 40])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        setZoomLevel(event.transform.k);
        draw();
      });
    select(canvas).call(behaviour);
    return () => {
      select(canvas).on(".zoom", null);
    };
  }, [draw]);

  useEffect(draw, [draw]);

  const nuclideAt = useCallback(
    (clientX: number, clientY: number): Nuclide | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      const worldX = t.invertX(clientX - rect.left);
      const worldY = t.invertY(clientY - rect.top);
      const n = Math.floor(worldX / baseCell);
      const z = bounds.maxZ - 1 - Math.floor(worldY / baseCell);
      return index.get(`${z}:${n}`) ?? null;
    },
    [baseCell, bounds.maxZ, index],
  );

  return (
    <div ref={wrapperRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height }}
        className="w-full cursor-crosshair rounded-xl bg-zinc-950 ring-1 ring-white/10"
        onMouseMove={(event) => {
          const nuclide = nuclideAt(event.clientX, event.clientY);
          setHover(
            nuclide
              ? { nuclide, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY }
              : null,
          );
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(event) => {
          const nuclide = nuclideAt(event.clientX, event.clientY);
          if (nuclide) onSelect(nuclide.nuclide_id);
        }}
      />

      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 font-mono text-[11px] text-zinc-400 backdrop-blur">
        {nuclides.length.toLocaleString()} nuclides · {zoomLevel.toFixed(1)}× ·
        scroll to zoom, drag to pan
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 min-w-44 rounded-lg border border-white/10 bg-zinc-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={{
            left: Math.min(hover.x + 14, size.width - 190),
            top: Math.max(8, hover.y - 70),
          }}
        >
          <div className="font-semibold text-zinc-100">
            {hover.nuclide.element_symbol}-{hover.nuclide.mass_number}
          </div>
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px] text-zinc-400">
            <span>Z / N</span>
            <span className="text-zinc-200">
              {hover.nuclide.z} / {hover.nuclide.n}
            </span>
            <span>Half-life</span>
            <span className="text-zinc-200">{formatHalfLife(hover.nuclide)}</span>
            <span>Decay</span>
            <span className="text-zinc-200">
              {hover.nuclide.primary_decay_mode ?? "—"}
              {hover.nuclide.decay_branch_count > 1 &&
                ` +${hover.nuclide.decay_branch_count - 1}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
