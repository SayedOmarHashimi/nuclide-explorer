export type Nuclide = {
  nuclide_id: string;
  z: number;
  n: number;
  mass_number: number;
  element_symbol: string;
  spin_parity: string | null;
  stability: "stable" | "unstable" | "unknown";
  half_life_seconds: number | null;
  log10_half_life_seconds: string | number | null;
  half_life_raw: string | null;
  half_life_unit: string | null;
  half_life_operator: string | null;
  half_life_is_limit: boolean;
  primary_decay_mode: string | null;
  primary_decay_pct: string | number | null;
  decay_branch_count: number;
  natural_abundance_pct: string | number | null;
  discovery_year: number | null;
};

export type DecayMode = {
  branch_index: number;
  mode_code: string;
  mode_label: string | null;
  branching_pct: string | number | null;
  is_terminal: boolean;
  is_fission: boolean;
  daughter_nuclide_id: string | null;
  daughter_element_symbol: string | null;
  daughter_mass_number: number | null;
  daughter_is_unknown: boolean;
};

export type ChainEdge = {
  parent_nuclide_id: string;
  daughter_nuclide_id: string;
  mode_code: string;
  mode_label: string | null;
  branching_pct: string | number | null;
  depth: number;
};

export type ChainResponse = {
  root: Nuclide;
  truncated: boolean;
  nodeCount: number;
  edgeCount: number;
  terminalNuclides: string[];
  nodes: Nuclide[];
  edges: ChainEdge[];
};

export const num = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
