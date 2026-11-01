// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { compare, lowered } from "./ratchet.mjs";

test("compare: a file absent from the baseline is held to zero", () => {
    assert.deepEqual(compare({}, { "new.ts": 1 }).over, [{ file: "new.ts", count: 1, allowed: 0 }]);
});

test("compare: equal passes, more fails, fewer is reported as below", () => {
    const { over, below } = compare({ "a.ts": 3, "b.ts": 3, "c.ts": 3 }, { "a.ts": 3, "b.ts": 4, "c.ts": 1 });
    assert.deepEqual(over, [{ file: "b.ts", count: 4, allowed: 3 }]);
    assert.deepEqual(below, [{ file: "c.ts", count: 1, allowed: 3 }]);
});

test("compare: a file translated to zero is below its baseline", () => {
    assert.deepEqual(compare({ "a.ts": 2 }, {}).below, [{ file: "a.ts", count: 0, allowed: 2 }]);
});

test("lowered: never raises, drops zeros and vanished files, ignores new files", () => {
    assert.deepEqual(lowered({ "a.ts": 2, "b.ts": 5, "gone.ts": 1 }, { "a.ts": 4, "b.ts": 1, "new.ts": 7 }), {
        "a.ts": 2,
        "b.ts": 1,
    });
});
