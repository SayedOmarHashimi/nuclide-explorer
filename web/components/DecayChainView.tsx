"use client";

import { useMemo } from "react";
import { DECAY_COLORS, formatHalfLife } from "@/lib/palette";
import { num, type ChainResponse, type Nuclide } from "@/lib/types";

/**
 * Decay-chain explorer.
 *
 * Rendered as a layered graph rather than a list, because 43% of nuclides have
 * more than one decay branch - a "chain" is really a tree that can rejoin.
 * Depth is computed by BFS from the root so a nuclide reachable by two routes
 * is drawn once, at its shortest depth, and both incoming edges point at it.
 *
 * SVG is the right choice here (unlike the main chart): a chain is tens of
 * nodes, not thousands, and SVG gives crisp text and hover targets for free.
 */

// Kept deliberately compact: the uranium series alone is 15 steps, and at
// generous node sizes the chain renders ~2,900px wide, which is more
// horizontal scrolling than the view is worth.
const NODE_WIDTH = 88;
const NODE_HEIGHT = 40;
const COLUMN_GAP = 42;
const ROW_GAP = 14;

type Props = {
  chain: ChainResponse;
  onSelect: (nuclideId: string) => void;
};

export default function DecayChainView({ chain, onSelect }: Props) {
  const layout = useMemo(() => {
    const nodesById = new Map<string, Nuclide>(
      chain.nodes.map((node) => [node.nuclide_id, node]),
    );

    // Shortest-path depth from the root. Using the minimum keeps a nuclide
    // that is reachable by several routes in a single column.
    const depth = new Map<string, number>([[chain.root.nuclide_id, 0]]);
    const queue: string[] = [chain.root.nuclide_id];
    while (queue.length) {
      const current = queue.shift()!;
      const currentDepth = depth.get(current)!;
      for (const edge of chain.edges) {
        if (edge.parent_nuclide_id !== current) continue;
        const existing = depth.get(edge.daughter_nuclide_id);
        if (existing === undefined || currentDepth + 1 < existing) {
          depth.set(edge.daughter_nuclide_id, currentDepth + 1);
          queue.push(edge.daughter_nuclide_id);
        }
      }
    }

    const columns = new Map<number, string[]>();
    for (const [id, level] of depth) {
      if (!columns.has(level)) columns.set(level, []);
      columns.get(level)!.push(id);
    }
    for (const ids of columns.values()) {
      ids.sort((a, b) => {
        const nodeA = nodesById.get(a);
        const nodeB = nodesById.get(b);
        return (nodeB?.z ?? 0) - (nodeA?.z ?? 0);
      });
    }

    const positions = new Map<string, { x: number; y: number }>();
    let maxRows = 1;
    for (const [level, ids] of columns) {
      maxRows = Math.max(maxRows, ids.length);
      ids.forEach((id, row) => {
        positions.set(id, {
          x: level * (NODE_WIDTH + COLUMN_GAP) + 12,
          y: row * (NODE_HEIGHT + ROW_GAP) + 12,
        });
      });
    }

    return {
      positions,
      nodesById,
      width: columns.size * (NODE_WIDTH + COLUMN_GAP) + 24,
      height: maxRows * (NODE_HEIGHT + ROW_GAP) + 24,
    };
  }, [chain]);

  const terminals = new Set(chain.terminalNuclides);

  return (
    <div className="overflow-x-auto">
      <svg
        width={layout.width}
        height={layout.height}
        className="min-w-full"
        role="img"
        aria-label={`Decay chain for ${chain.root.element_symbol}-${chain.root.mass_number}`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(161,161,170,0.75)" />
          </marker>
        </defs>

        {chain.edges.map((edge, i) => {
          const from = layout.positions.get(edge.parent_nuclide_id);
          const to = layout.positions.get(edge.daughter_nuclide_id);
          if (!from || !to) return null;
          const x1 = from.x + NODE_WIDTH;
          const y1 = from.y + NODE_HEIGHT / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_HEIGHT / 2;
          const midX = (x1 + x2) / 2;
          const pct = num(edge.branching_pct);
          return (
            <g key={`${edge.parent_nuclide_id}-${edge.daughter_nuclide_id}-${edge.mode_code}-${i}`}>
              <path
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={DECAY_COLORS[edge.mode_code.toUpperCase()] ?? "#71717a"}
                strokeOpacity={pct !== null && pct < 1 ? 0.32 : 0.75}
                strokeWidth={pct !== null && pct >= 50 ? 2 : 1.2}
                markerEnd="url(#arrow)"
              />
              <text
                x={midX}
                y={(y1 + y2) / 2 - 5}
                textAnchor="middle"
                className="fill-zinc-400 font-mono"
                fontSize={9.5}
              >
                {edge.mode_code}
                {pct !== null && pct < 100 ? ` ${pct < 0.1 ? pct.toExponential(1) : pct}%` : ""}
              </text>
            </g>
          );
        })}

        {[...layout.positions].map(([id, position]) => {
          const node = layout.nodesById.get(id);
          if (!node) return null;
          const isRoot = id === chain.root.nuclide_id;
          const isStable = node.stability === "stable";
          const isTerminal = terminals.has(id);
          return (
            <g
              key={id}
              transform={`translate(${position.x}, ${position.y})`}
              className="cursor-pointer"
              onClick={() => onSelect(id)}
            >
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={8}
                fill={isStable ? "rgba(228,228,231,0.14)" : "rgba(24,24,27,0.9)"}
                stroke={
                  isRoot ? "#ffffff" : isStable ? "rgba(228,228,231,0.6)" : "rgba(255,255,255,0.14)"
                }
                strokeWidth={isRoot ? 2 : 1}
              />
              <text x={8} y={17} className="fill-zinc-100" fontSize={12} fontWeight={600}>
                {node.element_symbol}-{node.mass_number}
              </text>
              <text x={8} y={30} className="fill-zinc-400 font-mono" fontSize={9}>
                {isStable ? "stable" : formatHalfLife(node)}
              </text>
              {isTerminal && !isStable && (
                <title>
                  Chain ends here: no further followable decay (fission, isomeric
                  transition, or unmeasured).
                </title>
              )}
            </g>
          );
        })}
      </svg>

      {chain.truncated && (
        <p className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Chain truncated at the depth limit — increase max depth to see further.
        </p>
      )}
    </div>
  );
}
