// node --test tests/: the views load (every import they use exists). They
// only touch the DOM when they render, so importing them needs no browser.
import assert from "node:assert/strict";
import { test } from "node:test";

test("views import what they use", async () => {
  for (const view of ["live", "tests", "run", "queue"]) {
    const mod = await import(`../js/views/${view}.js`);
    assert.ok(Object.keys(mod).length, view);
  }
});
