import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  decayChainQuerySchema,
  nuclideIdSchema,
  nuclideQuerySchema,
} from "../lib/validation.ts";

describe("nuclideIdSchema", () => {
  test("accepts well-formed ids and normalises case", () => {
    assert.equal(nuclideIdSchema.parse("u-238"), "u-238");
    assert.equal(nuclideIdSchema.parse("U-238"), "u-238");
    assert.equal(nuclideIdSchema.parse("  cs-137 "), "cs-137");
  });

  test("rejects anything that is not an element-mass pair", () => {
    for (const bad of [
      "u238",
      "u-238'; drop table nuclides;--",
      "../../etc/passwd",
      "uuuu-238",
      "u-12345",
      "",
      "%27",
    ]) {
      assert.equal(nuclideIdSchema.safeParse(bad).success, false, bad);
    }
  });
});

describe("nuclideQuerySchema", () => {
  test("applies defaults", () => {
    const parsed = nuclideQuerySchema.parse({});
    assert.equal(parsed.limit, 5000);
    assert.equal(parsed.offset, 0);
  });

  test("rejects unknown keys rather than ignoring them", () => {
    // .strict() matters: silently dropping an unrecognised filter would make
    // the API look like it applied a filter it did not.
    assert.equal(nuclideQuerySchema.safeParse({ bogus: "1" }).success, false);
  });

  test("bounds Z and N to physical ranges", () => {
    assert.equal(nuclideQuerySchema.safeParse({ zMin: "999" }).success, false);
    assert.equal(nuclideQuerySchema.safeParse({ nMin: "-1" }).success, false);
    assert.equal(nuclideQuerySchema.safeParse({ zMin: "0", zMax: "118" }).success, true);
  });

  test("rejects inverted ranges", () => {
    assert.equal(
      nuclideQuerySchema.safeParse({ zMin: "90", zMax: "10" }).success,
      false,
    );
  });

  test("caps limit so a single request cannot ask for unbounded rows", () => {
    assert.equal(nuclideQuerySchema.safeParse({ limit: "100000" }).success, false);
  });

  test("only accepts known decay modes", () => {
    assert.equal(nuclideQuerySchema.safeParse({ decayMode: "B-" }).success, true);
    assert.equal(nuclideQuerySchema.safeParse({ decayMode: "NOPE" }).success, false);
  });
});

describe("decayChainQuerySchema", () => {
  test("bounds recursion depth", () => {
    assert.equal(decayChainQuerySchema.parse({}).maxDepth, 30);
    assert.equal(decayChainQuerySchema.safeParse({ maxDepth: "999" }).success, false);
    assert.equal(decayChainQuerySchema.safeParse({ maxDepth: "0" }).success, false);
  });
});
