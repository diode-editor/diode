// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { test } from "node:test";

import { titleProblem } from "./check-pr-title.mjs";

const RU = "\u043a\u043e\u043c\u0430\u043d\u0434\u044b"; // "komandy"

test("titleProblem: an English conventional title passes", () => {
    assert.equal(titleProblem("fix(diff): compare commands return the promise (#743)"), null);
});

test("titleProblem: Cyrillic anywhere in the title fails", () => {
    assert.match(titleProblem(`fix(diff): ${RU} (#743)`) ?? "", /Cyrillic/);
});
