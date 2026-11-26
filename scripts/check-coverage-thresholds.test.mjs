// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { problems } from "./check-coverage-thresholds.mjs";

test("problems: four thresholds at 100 pass", () => {
    assert.deepEqual(problems({ statements: 100, branches: 100, functions: 100, lines: 100 }), []);
});

test("problems: a lowered or missing threshold is named with its value", () => {
    assert.deepEqual(problems({ statements: 100, branches: 48.71, functions: 100 }), ["branches: 48.71", "lines: undefined"]);
});

test("problems: no thresholds at all is four problems", () => {
    assert.equal(problems(undefined).length, 4);
});
