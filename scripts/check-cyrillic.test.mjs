// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { cyrillicLines, hasCyrillic, inScope } from "./check-cyrillic.mjs";

// Escapes, not literals: this file is itself under the ratchet.
const RU = "\u043f\u0440\u0438\u0432\u0435\u0442"; // "privet"
const ANCHOR = "\u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438"; // "kommentarii"

test("cyrillicLines: counts lines, not characters", () => {
    assert.equal(cyrillicLines(`a\n${RU} ${RU}\nb // ${RU}\nc`), 2);
});

test("cyrillicLines: binary file counts as zero", () => {
    assert.equal(cyrillicLines(`${RU}\0${RU}`), 0);
});

test("hasCyrillic: a Russian anchor of a doc link is not Russian text", () => {
    assert.equal(hasCyrillic(`// see docs/STYLE.md#${ANCHOR}-x2.`), false);
    assert.equal(hasCyrillic(`// see docs/STYLE.md#${ANCHOR} ${RU}`), true);
    assert.equal(hasCyrillic(`// #${ANCHOR}`), true);
});

test("inScope: markdown is out of scope except the public pages of the docs site", () => {
    assert.equal(inScope("src/vs/base/common/uri.ts"), true);
    assert.equal(inScope("docs/STYLE.md"), false);
    assert.equal(inScope("docs/public/API-COVERAGE.md"), true);
    assert.equal(inScope("docs/public/README.md"), false);
    assert.equal(inScope(".claude/skills/drive/run.ts"), false);
});
