import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clientKey, rateLimit } from "../lib/rateLimit.ts";

describe("rateLimit", () => {
  test("allows up to the limit then rejects", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) {
      assert.equal(rateLimit(key, 5).ok, true, `request ${i + 1}`);
    }
    assert.equal(rateLimit(key, 5).ok, false);
  });

  test("counts down remaining and reports a retry delay", () => {
    const key = `test-${Math.random()}`;
    assert.equal(rateLimit(key, 3).remaining, 2);
    assert.equal(rateLimit(key, 3).remaining, 1);
    const third = rateLimit(key, 3);
    assert.equal(third.remaining, 0);
    assert.ok(third.retryAfterSeconds > 0 && third.retryAfterSeconds <= 60);
  });

  test("buckets are independent", () => {
    const a = `test-a-${Math.random()}`;
    const b = `test-b-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) rateLimit(a, 5);
    assert.equal(rateLimit(a, 5).ok, false);
    assert.equal(rateLimit(b, 5).ok, true);
  });
});

describe("clientKey", () => {
  test("prefers the left-most x-forwarded-for entry", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" },
    });
    assert.equal(clientKey(request), "203.0.113.7");
  });

  test("falls back to x-real-ip, then to a constant", () => {
    assert.equal(
      clientKey(new Request("http://localhost/", { headers: { "x-real-ip": "198.51.100.4" } })),
      "198.51.100.4",
    );
    assert.equal(clientKey(new Request("http://localhost/")), "unknown");
  });
});
