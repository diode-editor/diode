#!/usr/bin/env node
// Fast inner loop over the branch diff: types, lint and tests of the changed files only.
// NOT a hand-off gate: the full gates stay before the PR and in CI (docs/TESTING.md). Flags: usage().
//
// Steps run SEQUENTIALLY: tsc and type-aware eslint each build a program and fight over
// memory in parallel.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CACHE_DIR = "node_modules/.cache/diode";
const SOURCE_RE = /^(src|extensions)\/.+\.(ts|mts|cts)$/;
const TEST_RE = /\.test\.ts$/;
const STEPS = ["tsc", "lint", "ratchet", "test"];

function usage(code) {
    console.log(`Usage: npm run check:diff -- [--base <ref>] [--near] [--coverage] [--skip tsc,lint,ratchet,test] [--list]

  --base <ref>   diff base (merge-base with origin/main by default)
  --near         instead of \`vitest related\` (the whole importer graph), only neighbor
                 tests: Foo.ts → Foo.test.ts, Foo.*.test.ts; plus the changed tests
  --coverage     add coverage of the changed non-test files (the ratchet is untouched)
  --skip <steps> skip comma-separated steps: tsc, lint, ratchet, test
  --list         only list the diff files and exit`);
    process.exit(code);
}

function parseArgs(argv) {
    const opts = { base: undefined, near: false, coverage: false, skip: new Set(), list: false };
    const addSkip = (v) => {
        for (const s of v.split(",")) if (s.trim()) opts.skip.add(s.trim());
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--help" || a === "-h") usage(0);
        else if (a === "--near") opts.near = true;
        else if (a === "--coverage") opts.coverage = true;
        else if (a === "--list") opts.list = true;
        else if (a === "--base") opts.base = argv[++i] ?? "";
        else if (a.startsWith("--base=")) opts.base = a.slice("--base=".length);
        else if (a === "--skip") addSkip(argv[++i] ?? "");
        else if (a.startsWith("--skip=")) addSkip(a.slice("--skip=".length));
        else {
            console.error(`check:diff: unknown argument "${a}"`);
            usage(2);
        }
    }
    for (const s of opts.skip) {
        if (!STEPS.includes(s)) {
            console.error(`check:diff: unknown step in --skip: "${s}" (known: ${STEPS.join(", ")})`);
            process.exit(2);
        }
    }
    if (opts.base === "") usage(2);
    return opts;
}

function git(args) {
    const r = spawnSync("git", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
    return r.stdout;
}

function lines(s) {
    return s.split("\n").filter(Boolean);
}

function changedFiles(base) {
    const files = new Set([
        ...lines(git(["diff", "--name-only", "--diff-filter=ACMR", base])),
        ...lines(git(["ls-files", "--others", "--exclude-standard"])),
    ]);
    return [...files].filter((f) => SOURCE_RE.test(f) && existsSync(f)).sort();
}

function nearTests(files) {
    const out = new Set(files.filter((f) => TEST_RE.test(f)));
    for (const f of files) {
        if (TEST_RE.test(f)) continue;
        const dir = path.dirname(f);
        const stem = path.basename(f).replace(/\.(ts|mts|cts)$/, "");
        for (const name of readdirSync(dir)) {
            if (TEST_RE.test(name) && (name === `${stem}.test.ts` || name.startsWith(`${stem}.`))) {
                out.add(path.posix.join(dir, name));
            }
        }
    }
    return [...out].sort();
}

function run(title, cmd, args) {
    console.log(`\n▶ ${title}`);
    const started = Date.now();
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const ok = r.status === 0;
    console.log(`${ok ? "✓" : "✗"} ${title} — ${secs} s`);
    return ok;
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const base = opts.base ?? git(["merge-base", "origin/main", "HEAD"]).trim();
    const files = changedFiles(base);
    const shortBase = git(["rev-parse", "--short", base]).trim();

    console.log(`check:diff: base ${shortBase}, files in diff: ${files.length}`);
    for (const f of files) console.log(`  ${f}`);
    if (opts.list) return;
    if (files.length === 0) {
        console.log("Nothing to check: no changes in src/ and extensions/.");
        return;
    }

    mkdirSync(CACHE_DIR, { recursive: true });
    const bin = (name) => path.join("node_modules", ".bin", name);
    const failed = [];

    if (!opts.skip.has("tsc")) {
        // The whole program: an edit in one file breaks others.
        const ok = run("tsc --noEmit --incremental", bin("tsc"), [
            "--noEmit",
            "--incremental",
            "--tsBuildInfoFile",
            `${CACHE_DIR}/tsc.tsbuildinfo`,
        ]);
        if (!ok) failed.push("tsc");
    }

    if (!opts.skip.has("lint")) {
        // The eslint cache doesn't know about cross-file dependencies: when a type changes in a
        // neighbor file the verdict isn't rechecked. So the full `npm run lint` stays with CI.
        const ok = run(`eslint (${files.length})`, bin("eslint"), [
            "--cache",
            "--cache-strategy",
            "content",
            "--cache-location",
            `${CACHE_DIR}/eslint`,
            "--no-warn-ignored",
            ...files,
        ]);
        if (!ok) failed.push("lint");
    }

    if (!opts.skip.has("ratchet") && files.some((f) => !TEST_RE.test(f))) {
        // Dead code is deleted, not silenced (docs/MUTATION.md): the per-file count of
        // `Stryker disable` markers about unreachable code only goes down.
        if (!run("stryker-disable ratchet", process.execPath, ["scripts/check-stryker-disable.mjs"])) failed.push("ratchet");
    }

    if (!opts.skip.has("test")) {
        let args;
        if (opts.near) {
            const tests = nearTests(files);
            console.log(`\nNeighbor tests: ${tests.length}`);
            for (const t of tests) console.log(`  ${t}`);
            args = ["run", "--passWithNoTests", ...tests];
            if (tests.length === 0) args = undefined;
        } else {
            // For a module in base/ or platform/ this is hundreds of files; use --near then.
            args = ["related", "--run", "--passWithNoTests", ...files];
        }
        if (args && opts.coverage) {
            const sources = files.filter((f) => !TEST_RE.test(f));
            // The 100% ratchet with autoUpdate on a subset of tests goes red and rewrites vitest.config.ts.
            args.push(
                "--coverage",
                "--coverage.thresholds.autoUpdate=false",
                "--coverage.thresholds.statements=0",
                "--coverage.thresholds.branches=0",
                "--coverage.thresholds.functions=0",
                "--coverage.thresholds.lines=0",
                "--coverage.reporter=text",
                "--coverage.skipFull=false",
                "--coverage.reportsDirectory",
                `${CACHE_DIR}/coverage`,
                ...sources.map((f) => `--coverage.include=${f}`),
            );
        }
        if (args) {
            const title = `vitest ${opts.near ? "run (neighbors)" : "related"}${opts.coverage ? " --coverage" : ""}`;
            if (!run(title, bin("vitest"), args)) failed.push("test");
        } else {
            console.log("No tests next to the changed files, skipping the test step.");
        }
    }

    console.log(
        failed.length === 0
            ? "\ncheck:diff: green. Before hand-off, run the full gates (lint, typecheck, test:coverage, test:mutation)."
            : `\ncheck:diff: red: ${failed.join(", ")}.`,
    );
    process.exitCode = failed.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    try {
        main();
    } catch (e) {
        console.error(`check:diff: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 2;
    }
}
