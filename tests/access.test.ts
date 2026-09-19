import assert from "node:assert/strict";
import test from "node:test";
import { createAccessSession, isAuthorized, validAccessSession } from "../src/lib/access.ts";

const secret = "test-only-access-token";

test("a shared access session expires and rejects tampering", () => {
  const now = Date.UTC(2026, 8, 19);
  const cookie = createAccessSession(secret, now);
  assert.equal(validAccessSession(cookie, secret, now), true);
  assert.equal(validAccessSession(cookie, "wrong-token", now), false);
  assert.equal(validAccessSession(cookie, secret, now + 8 * 24 * 60 * 60 * 1000), false);
  assert.equal(validAccessSession(cookie.slice(0, -1) + "0", secret, now), false);
});

test("browser writes need same origin; API callers can use a bearer token", () => {
  const now = Date.now();
  const cookie = createAccessSession(secret, now);
  const headers = { cookie: `webforge_access=${cookie}` };
  assert.equal(isAuthorized(new Request("https://example.com/api/jobs", { method: "POST", headers }), secret, true), false);
  assert.equal(isAuthorized(new Request("https://example.com/api/jobs", { method: "POST", headers: { ...headers, origin: "https://example.com" } }), secret, true), true);
  assert.equal(isAuthorized(new Request("https://example.com/api/jobs", { headers: { authorization: `Bearer ${secret}` } }), secret, true), true);
});
