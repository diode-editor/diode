import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { dependencyClosure, patchUtils, SUITES, transformManifest } from "./build.mjs";
import { compareSuite, formatBaseline, formatReport, greenTitles, parseResults, readBaseline, staleExclusions, testKey, unfinishedTitles, writeBaseline } from "./compare.mjs";

const here = import.meta.dirname;
const repoRoot = path.resolve(here, "..", "..");

const jsonl = (...records) => records.map((record) => JSON.stringify(record)).join("\n");

test("parseResults reads every record kind", () => {
    const results = parseResults(
        jsonl({ kind: "plan", titles: ["a", "b", "c"] }, { kind: "pass", title: "a" }, { kind: "fail", title: "b", error: "boom" }, { kind: "skip", title: "c" }, { kind: "end" }),
    );
    assert.deepEqual(results.planned, ["a", "b", "c"]);
    assert.deepEqual(results.passed, ["a"]);
    assert.equal(results.failed.get("b"), "boom");
    assert.deepEqual(results.skipped, ["c"]);
    assert.equal(results.ended, true);
});

test("parseResults survives a last line cut off by a killed editor", () => {
    const results = parseResults(`${jsonl({ kind: "pass", title: "a" })}\n{"kind":"pa`);
    assert.deepEqual(results.passed, ["a"]);
    assert.equal(results.ended, false);
});

test("parseResults keeps a load error", () => {
    assert.equal(parseResults(jsonl({ kind: "load-error", error: "no file" })).loadError, "no file");
});

test("a test that passed and then failed in a hook is not green", () => {
    const results = parseResults(jsonl({ kind: "pass", title: "a" }, { kind: "fail", title: "a", error: "hook" }, { kind: "pass", title: "b" }));
    assert.deepEqual([...greenTitles(results)], ["b"]);
});

test("planned tests a hung session never reached are unfinished, and so are not green", () => {
    const results = parseResults(jsonl({ kind: "plan", titles: ["a", "b", "c", "d"] }, { kind: "pass", title: "a" }, { kind: "fail", title: "b", error: "x" }, { kind: "skip", title: "c" }));
    assert.deepEqual(unfinishedTitles(results), ["d"]);
    assert.equal(greenTitles(results).has("d"), false);
});

test("a baseline test that is not green is a regression", () => {
    const comparison = compareSuite({ suite: "s", green: new Set(["a"]), baseline: new Set(["a", "b"]), exclusions: {} });
    assert.deepEqual(comparison, { regressions: ["b"], newGreen: [], excludedGreen: [] });
});

test("a green test outside the baseline is a hint, not a regression", () => {
    const comparison = compareSuite({ suite: "s", green: new Set(["a", "b"]), baseline: new Set(["a"]), exclusions: {} });
    assert.deepEqual(comparison, { regressions: [], newGreen: ["b"], excludedGreen: [] });
});

test("exclusions apply per suite, count for neither side and are reported when green", () => {
    const exclusions = { "s proposed": "proposed API", "s flaky": "flaky: races", "s red": "flaky", "other a": "not this suite" };
    const comparison = compareSuite({ suite: "s", green: new Set(["proposed", "flaky", "a"]), baseline: new Set(["red", "a"]), exclusions });
    assert.deepEqual(comparison, { regressions: [], newGreen: [], excludedGreen: ["proposed"] });
    assert.deepEqual(compareSuite({ suite: "s", green: new Set(), baseline: new Set(["a"]), exclusions }).regressions, ["a"]);
});

test("an exclusion naming no planned test is stale; a suite without a plan says nothing", () => {
    const exclusions = { "s known": "x", "s gone": "x", "t any": "x", "s.other gone": "x" };
    assert.deepEqual(staleExclusions(exclusions, { s: { planned: ["known"] }, t: { planned: [] } }), ["s gone"]);
});

test("the baseline is written sorted, one per line, without excluded tests, and reads back", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "api-conformance-test-"));
    try {
        writeBaseline(dir, "s", new Set(["b", "a", "skip me"]), { "s skip me": "flaky" });
        assert.equal(readFileSync(path.join(dir, "s.txt"), "utf8"), "a\nb\n");
        assert.deepEqual([...readBaseline(dir, "s")], ["a", "b"]);
        assert.deepEqual([...readBaseline(dir, "absent")], []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(formatBaseline([]), "");
});

test("the report prints totals and names what changed", () => {
    const suite = {
        suite: "s",
        greenCount: 2,
        redCount: 1,
        skippedCount: 3,
        unfinishedCount: 4,
        excludedCount: 5,
        comparison: { regressions: ["r"], newGreen: ["n"], excludedGreen: ["e"] },
    };
    const text = formatReport([suite]);
    assert.match(text, /Total: 2 green, 1 red, 3 skipped, 5 excluded\./);
    assert.match(text, /unfinished 4/);
    assert.match(text, /REGRESSIONS[^\n]*\n {2}s r/);
    assert.match(text, /--update\n {2}s n/);
    assert.match(text, /exclusions\.json:\n {2}s e/);
});

test("a clean report has no change sections", () => {
    const text = formatReport([{ suite: "s", greenCount: 1, redCount: 0, skippedCount: 0, unfinishedCount: 0, excludedCount: 0, comparison: { regressions: [], newGreen: [], excludedGreen: [] } }]);
    assert.doesNotMatch(text, /REGRESSIONS|New green|Excluded tests|unfinished/);
});

test("the manifest gets our entry point, loses build fields and keeps upstream's settings", () => {
    const manifest = transformManifest({
        name: "n",
        main: "./out/extension",
        activationEvents: [],
        scripts: {},
        devDependencies: {},
        dependencies: {},
        contributes: { views: {}, configuration: { properties: { "farboo.get": { type: "string" } } } },
    });
    assert.equal(manifest.main, "./extension.js");
    assert.deepEqual(manifest.activationEvents, ["*"]);
    assert.equal("scripts" in manifest || "devDependencies" in manifest || "dependencies" in manifest, false);
    assert.deepEqual(manifest.contributes.views, {});
    assert.deepEqual(manifest.contributes.configuration.properties["farboo.get"], { type: "string" });
    assert.equal(manifest.contributes.configuration.properties["tasks.version"].default, "2.0.0");
});

test("an unexpected manifest shape fails instead of dropping settings", () => {
    assert.throws(() => transformManifest({ contributes: { configuration: [] } }), /contributes\.configuration/);
    assert.throws(() => transformManifest({}), /contributes\.configuration/);
});

const UTILS = `before
export async function createRandomFile(contents = '') {
	fake();
}
middle
export async function deleteFile(file) {
	fake();
}
after
`;

test("the helpers of upstream's utils move to real files, the rest of the text stays", () => {
    const patched = patchUtils(UTILS);
    assert.doesNotMatch(patched, /fake\(\)/);
    assert.match(patched, /workspace\.fs\.writeFile/);
    assert.match(patched, /workspace\.fs\.delete/);
    assert.match(patched, /^before\n/);
    assert.match(patched, /\nmiddle\n/);
    assert.match(patched, /\nafter\n$/);
});

test("a helper missing from upstream's text is a clear error, by name", () => {
    assert.throws(() => patchUtils("export async function deleteFile(f) {\n}\n"), /createRandomFile not found/);
    assert.throws(() => patchUtils("export async function createRandomFile(f) {\n}\n"), /deleteFile not found/);
});

test("the mocha closure carries its dependencies, with paths under node_modules", () => {
    const closure = dependencyClosure(repoRoot, "mocha");
    assert.ok(closure.includes(path.join("node_modules", "mocha")));
    assert.ok(closure.length > 1);
    assert.ok(closure.every((entry) => entry.startsWith("node_modules")));
});

test("a missing dependency is reported", () => {
    assert.throws(() => dependencyClosure(repoRoot, "no-such-package-for-sure"), /no-such-package-for-sure/);
});

const baselineDir = path.join(here, "baseline");
const baselines = new Map(SUITES.map((suite) => [suite, readBaseline(baselineDir, suite)]));
const exclusions = JSON.parse(readFileSync(path.join(here, "exclusions.json"), "utf8"));
const memberMap = JSON.parse(readFileSync(path.join(here, "memberMap.json"), "utf8"));
const greenKeys = new Set([...baselines].flatMap(([suite, titles]) => [...titles].map((title) => testKey(suite, title))));

test("baseline files are named after known suites and stay sorted", () => {
    for (const file of readdirSync(baselineDir)) {
        const suite = file.replace(/\.txt$/, "");
        assert.ok(SUITES.includes(suite), file);
        const text = readFileSync(path.join(baselineDir, file), "utf8");
        assert.equal(text, formatBaseline(text.split("\n").filter((line) => line !== "")), file);
    }
});

test("no excluded test is in the baseline, and every exclusion has a reason", () => {
    for (const [key, reason] of Object.entries(exclusions)) {
        assert.equal(greenKeys.has(key), false, key);
        assert.ok(reason.length > 0, key);
    }
});

test("the member map only speaks about green tests and names members", () => {
    for (const [key, members] of Object.entries(memberMap)) {
        assert.ok(greenKeys.has(key), `not in the baseline: ${key}`);
        assert.ok(members.length > 0, key);
        for (const member of members) assert.match(member, /^[A-Za-z]+(\.[A-Za-z]+)*$/, key);
    }
});
