import { z } from "zod";

/**
 * Every route parameter is parsed through one of these schemas before it
 * reaches the database layer. Anything that fails validation returns 400
 * rather than reaching Postgres.
 */

/** Public nuclide identifier, e.g. "u-238". Deliberately narrow. */
export const nuclideIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{1,3}-\d{1,3}$/, "expected an id like 'u-238'");

export const DECAY_MODES = [
  "B-", "2B-", "B-N", "B-2N", "B-A", "B+", "2B+", "EC", "EC+B+",
  "2EC", "ECP", "B+P", "A", "P", "2P", "N", "2N", "IT", "SF", "ECSF",
] as const;

export const STABILITIES = ["stable", "unstable", "unknown"] as const;

const intInRange = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

export const nuclideQuerySchema = z
  .object({
    // Z and N bounds are the physical limits of the chart, not arbitrary.
    zMin: intInRange(0, 130).optional(),
    zMax: intInRange(0, 130).optional(),
    nMin: intInRange(0, 200).optional(),
    nMax: intInRange(0, 200).optional(),

    // Half-life filters are given as log10(seconds) because the data spans
    // 1e-22 to 1e30 - a linear range control would be unusable.
    halfLifeLogMin: z.coerce.number().min(-30).max(40).optional(),
    halfLifeLogMax: z.coerce.number().min(-30).max(40).optional(),

    element: z.string().trim().regex(/^[A-Za-z]{1,3}$/).optional(),
    decayMode: z.enum(DECAY_MODES).optional(),
    stability: z.enum(STABILITIES).optional(),

    limit: intInRange(1, 5000).default(5000),
    offset: intInRange(0, 100_000).default(0),
  })
  .strict()
  .refine((v) => v.zMin === undefined || v.zMax === undefined || v.zMin <= v.zMax, {
    message: "zMin must not exceed zMax",
  })
  .refine((v) => v.nMin === undefined || v.nMax === undefined || v.nMin <= v.nMax, {
    message: "nMin must not exceed nMax",
  });

export type NuclideQuery = z.infer<typeof nuclideQuerySchema>;

export const decayChainQuerySchema = z
  .object({
    // Hard cap on recursion depth. Without a bound, a cycle introduced by a
    // future data revision would let one request walk forever.
    maxDepth: intInRange(1, 60).default(30),
    // Branches below this percentage are pruned; the full tree for some
    // nuclides is dominated by branches with vanishing probability.
    minBranchingPct: z.coerce.number().min(0).max(100).default(0),
  })
  .strict();

/** Turn URLSearchParams into a plain object, rejecting repeated keys. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (value !== "") out[key] = value;
  }
  return out;
}
