// Run: node --test scripts/agent-loop/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { bodyBlockers } from "./lib.mjs";

test("bodyBlockers: a dedicated line names every blocker", () => {
    assert.deepEqual(bodyBlockers("Spec text.\n\nBlocked by #123, #124\n", 200), { numbers: [123, 124], self: false });
});

test("bodyBlockers: colon, bullet and bold markers are allowed", () => {
    assert.deepEqual(bodyBlockers("- **Blocked by:** #7 #8.", 1).numbers, [7, 8]);
});

test("bodyBlockers: several lines add up without duplicates", () => {
    assert.deepEqual(bodyBlockers("Blocked by #5\nblocked by #5, #6", 1).numbers, [5, 6]);
});

test("bodyBlockers: the phrase inside prose does not count", () => {
    const note = "Decision: order is #981 first, #1023 Blocked by #981.";
    assert.deepEqual(bodyBlockers(note, 981), { numbers: [], self: false });
});

test("bodyBlockers: the issue's own number is dropped and reported", () => {
    assert.deepEqual(bodyBlockers("Blocked by #981, #12", 981), { numbers: [12], self: true });
});

test("bodyBlockers: no body, no blockers", () => {
    assert.deepEqual(bodyBlockers(undefined, 1), { numbers: [], self: false });
});
