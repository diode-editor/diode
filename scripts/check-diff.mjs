#!/usr/bin/env node
// Быстрый внутренний цикл по диффу ветки: типы, линт и тесты только того, что
// поменялось относительно origin/main. Это НЕ гейт сдачи — полные `npm run lint`,
// `npm run typecheck`, `npm run test:coverage` и мутационный гейт остаются
// перед PR и в CI (docs/TESTING.md, «Быстрый цикл по диффу»).
//
//   npm run check:diff                     # tsc + eslint + vitest related
//   npm run check:diff -- --near           # тесты только соседние (Foo.ts → Foo*.test.ts)
//   npm run check:diff -- --coverage       # + покрытие изменённых файлов (без храповика)
//   npm run check:diff -- --base <ref>     # база вместо merge-base с origin/main
//   npm run check:diff -- --skip tsc,lint  # пропустить шаги (tsc | lint | test)
//
// Шаги идут ПОСЛЕДОВАТЕЛЬНО: машина маленькая, tsc и type-aware eslint строят
// по программе каждый — параллельно они дерутся за память.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CACHE_DIR = "node_modules/.cache/diode";
const SOURCE_RE = /^(src|extensions)\/.+\.(ts|mts|cts)$/;
const TEST_RE = /\.test\.ts$/;
const STEPS = ["tsc", "lint", "test"];

function usage(code) {
    console.log(`Использование: npm run check:diff -- [--base <ref>] [--near] [--coverage] [--skip tsc,lint,test] [--list]

  --base <ref>   база диффа (по умолчанию merge-base с origin/main)
  --near         вместо \`vitest related\` (весь граф импортёров) — только соседние
                 тесты: Foo.ts → Foo.test.ts, Foo.*.test.ts; плюс изменённые тесты
  --coverage     добавить покрытие изменённых не-тестовых файлов (храповик не трогается)
  --skip <шаги>  пропустить шаги через запятую: tsc, lint, test
  --list         только показать файлы диффа и выйти`);
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
            console.error(`check:diff: неизвестный аргумент «${a}»`);
            usage(2);
        }
    }
    for (const s of opts.skip) {
        if (!STEPS.includes(s)) {
            console.error(`check:diff: неизвестный шаг в --skip: «${s}» (есть: ${STEPS.join(", ")})`);
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

/** Изменённые относительно базы (+ неотслеженные) .ts из src/ и extensions/, которые ещё существуют. */
function changedFiles(base) {
    const files = new Set([
        ...lines(git(["diff", "--name-only", "--diff-filter=ACMR", base])),
        ...lines(git(["ls-files", "--others", "--exclude-standard"])),
    ]);
    return [...files].filter((f) => SOURCE_RE.test(f) && existsSync(f)).sort();
}

/** Соседние тесты: Foo.ts → Foo.test.ts и Foo.<что-угодно>.test.ts в том же каталоге. */
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
    console.log(`${ok ? "✓" : "✗"} ${title} — ${secs} с`);
    return ok;
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    const base = opts.base ?? git(["merge-base", "origin/main", "HEAD"]).trim();
    const files = changedFiles(base);
    const shortBase = git(["rev-parse", "--short", base]).trim();

    console.log(`check:diff: база ${shortBase}, файлов в диффе: ${files.length}`);
    for (const f of files) console.log(`  ${f}`);
    if (opts.list) return;
    if (files.length === 0) {
        console.log("Нечего проверять: в src/ и extensions/ изменений нет.");
        return;
    }

    mkdirSync(CACHE_DIR, { recursive: true });
    const bin = (name) => path.join("node_modules", ".bin", name);
    const failed = [];

    if (!opts.skip.has("tsc")) {
        // Типы — всегда по всей программе: правка в одном файле ломает чужие.
        // --incremental с buildinfo в кэше делает повторный прогон дешёвым.
        const ok = run("tsc --noEmit --incremental", bin("tsc"), [
            "--noEmit",
            "--incremental",
            "--tsBuildInfoFile",
            `${CACHE_DIR}/tsc.tsbuildinfo`,
        ]);
        if (!ok) failed.push("tsc");
    }

    if (!opts.skip.has("lint")) {
        // Кэш eslint с type-aware правилами не знает о зависимостях между
        // файлами: сменился тип в соседнем файле — закэшированный вердикт
        // не перепроверится. Поэтому полный `npm run lint` остаётся за CI.
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

    if (!opts.skip.has("test")) {
        let args;
        if (opts.near) {
            const tests = nearTests(files);
            console.log(`\nСоседних тестов: ${tests.length}`);
            for (const t of tests) console.log(`  ${t}`);
            args = ["run", "--passWithNoTests", ...tests];
            if (tests.length === 0) args = undefined;
        } else {
            // related: все тесты, которые транзитивно импортируют изменённое.
            // Для модуля из base/ или platform/ это сотни файлов — тогда --near.
            args = ["related", "--run", "--passWithNoTests", ...files];
        }
        if (args && opts.coverage) {
            const sources = files.filter((f) => !TEST_RE.test(f));
            // Глобальный храповик 100% с autoUpdate на подмножестве тестов
            // покраснеет (и перепишет vitest.config.ts) — гасим оба.
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
            const title = `vitest ${opts.near ? "run (соседние)" : "related"}${opts.coverage ? " --coverage" : ""}`;
            if (!run(title, bin("vitest"), args)) failed.push("test");
        } else {
            console.log("Тестов рядом с изменёнными файлами нет — шаг test пропущен.");
        }
    }

    console.log(
        failed.length === 0
            ? "\ncheck:diff: зелёный. Перед сдачей — полные гейты (lint, typecheck, test:coverage, test:mutation)."
            : `\ncheck:diff: красный — ${failed.join(", ")}.`,
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
