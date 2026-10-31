/**
 * Runs the real command against a real editor, so it is not part of `test:scripts`. Under a lease:
 *
 *   claude-lease run -- node --test e2e/api-conformance/conformance.live.mjs
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

const here = import.meta.dirname;

test("--update exits non-zero when a test file hung and its baseline could not be rewritten", () => {
    const baselineFile = path.join(here, "baseline", "env.txt");
    const before = readFileSync(baselineFile, "utf8");

    const run = spawnSync(process.execPath, [path.join(here, "run.mjs"), "--only", "env", "--hang", "env", "--file-timeout", "5", "--update"], {
        encoding: "utf8",
        timeout: 300_000,
    });

    // Not rewritten is right: a hung run says nothing about the baseline. Reporting success is the bug.
    assert.equal(readFileSync(baselineFile, "utf8"), before);
    assert.match(run.stdout, /did not finish/);
    assert.notEqual(run.status, 0, `the update did not happen, yet the command succeeded:\n${run.stdout}`);
});
