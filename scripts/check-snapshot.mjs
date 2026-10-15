#!/usr/bin/env node
/**
 * Гейт V8-снапшота ядра (`npm run snapshot-check`, CI job `static`).
 *
 * SEA-бинарь стартует из снапшота (`useSnapshot`, scripts/build-sea.mjs): верхний
 * уровень модулей `dist/main.cjs` исполняется ОДИН раз — при сборке, на машине CI,
 * а пользователю приезжает готовая куча. Всё, что верхний уровень прочитал из
 * окружения процесса, запекается и молча врёт у пользователя: сборка снапшота от
 * этого не падает, падает она только на нативных объектах (`Intl.*`, сокеты,
 * парсеры). Правила — docs/arch/Common.md («Верхний уровень модулей и V8-снапшот»).
 *
 * Три проверки:
 *  1. **Ловушки** (`snapshot-audit-prelude.cjs` перед `main.cjs`): каждое чтение
 *     окружения, времени, случайности и таймер на верхнем уровне — со стеком и
 *     модулем-виновником. Исключения — {@link ALLOWED_TOP_LEVEL} с причиной.
 *  2. **Отравленная сборка**: снапшот настоящего `main.cjs` собирается тем же
 *     входом, что у бинаря (`snapshot-entry.cjs`: eager-компиляция), node из
 *     каталога с меткой, в cwd с меткой, с метками в HOME, TMPDIR, XDG_*, PATH,
 *     TERM, LANG, argv. Меток в блобе не может быть больше, чем у пустого
 *     снапшота того же node (он сам кладёт туда `execPath` и `argv` сборки и
 *     обновляет их на старте). Лишняя метка — значение окружения запеклось в куче,
 *     в том числе через ленивый синглтон, инициализированный при сборке.
 *  3. **Поведение после десериализации** того же отравленного блоба в чистом
 *     окружении: `--version`, CLI расширений пишет в HOME запуска, run-as-node
 *     (`-e` и скрипт) видит `require`, `module`, `require.main`, argv, cwd, HOME
 *     и TMPDIR запуска.
 *
 * Сборка снапшота — `node --snapshot-blob`, без SEA: куча та же, а бинарь (секунды
 * и сотни МБ) не нужен. Сам бинарь со снапшотом проверяют e2e на SEA и самотест
 * `build-sea.mjs` на каждой платформе релиза.
 *
 *   node scripts/check-snapshot.mjs                 # собрать main.cjs во временный каталог (tsup)
 *   node scripts/check-snapshot.mjs --main <путь>   # проверить готовый main.cjs
 */

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { SNAPSHOT_BUILD_FLAGS, SNAPSHOT_ENTRY, snapshotEntryEnv } from "./build-lazy-chunks.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const PRELUDE = join(import.meta.dirname, "snapshot-audit-prelude.cjs");

/**
 * Чтения на верхнем уровне, которые запекаются осознанно. Ключ — что прочитано
 * (`what` ловушки) и модуль бандла, значение — почему это безопасно.
 *
 * @type {ReadonlyArray<{ what: string, module: string, why: string }>}
 */
export const ALLOWED_TOP_LEVEL = [
    {
        what: "process.env.VSCODE_TEXTMATE_DEBUG",
        module: "node_modules/vscode-textmate/release/main.js",
        why: "отладочный флаг чужого пакета (DebugFlags.InDebugMode): в сборке не задан и запекается false — у пользователя отладка textmate через env не включится, и это нормально",
    },
];

/**
 * Метки отравленного окружения сборки. Латиница с цифрой: строка однобайтная, и в
 * блобе её видно как есть (двухбайтные ищутся отдельно, UTF-16LE).
 */
const MARKS = {
    cwd: "Zq7snapCwd",
    execPath: "Zq7snapExec",
    home: "Zq7snapHome",
    tmp: "Zq7snapTmp",
    xdg: "Zq7snapXdg",
    path: "Zq7snapPath",
    term: "Zq7snapTerm",
    lang: "Zq7snapLang",
    user: "Zq7snapUser",
    argv: "Zq7snapArgv",
    env: "Zq7snapEnv",
};

/** Окружение сборки с метками — всё, откуда код берёт пути и настройки пользователя. */
function poisonedEnv() {
    const env = {
        PATH: `${join("/", MARKS.path)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        HOME: join("/", MARKS.home),
        USERPROFILE: join("/", MARKS.home),
        TMPDIR: join("/", MARKS.tmp),
        TMP: join("/", MARKS.tmp),
        TEMP: join("/", MARKS.tmp),
        XDG_CONFIG_HOME: join("/", MARKS.xdg, "config"),
        XDG_CACHE_HOME: join("/", MARKS.xdg, "cache"),
        XDG_DATA_HOME: join("/", MARKS.xdg, "data"),
        XDG_STATE_HOME: join("/", MARKS.xdg, "state"),
        XDG_RUNTIME_DIR: join("/", MARKS.xdg, "run"),
        APPDATA: join("/", MARKS.xdg, "appdata"),
        LOCALAPPDATA: join("/", MARKS.xdg, "localappdata"),
        TERM: MARKS.term,
        COLORTERM: MARKS.term,
        TERM_PROGRAM: MARKS.term,
        LANG: MARKS.lang,
        LC_ALL: MARKS.lang,
        USER: MARKS.user,
        LOGNAME: MARKS.user,
        USERNAME: MARKS.user,
        SHELL: join("/", MARKS.user, "sh"),
        EDITOR: MARKS.env,
        TMUX: MARKS.env,
        COLUMNS: "7",
        LINES: "7",
    };
    // Windows без SystemRoot не поднимает и сам node.
    for (const key of ["SystemRoot", "SYSTEMROOT", "windir"]) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
}

/** Окружение без NODE_OPTIONS: флаги V8 сборки — только {@link SNAPSHOT_BUILD_FLAGS}, как у build-sea. */
function cleanEnv(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.NODE_OPTIONS;
    return env;
}

/**
 * Собирает снапшот `entry` и возвращает stderr сборки; падает с ним, если сборка
 * упала (нативный объект на верхнем уровне: «global handle not serialized»).
 */
function buildSnapshot({ node, entry, blob, cwd, env, extraArgs = [] }) {
    const result = spawnSync(node, [...SNAPSHOT_BUILD_FLAGS, "--snapshot-blob", blob, "--build-snapshot", entry, ...extraArgs], {
        cwd,
        env,
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error(
            `снапшот ${basename(entry)} не собрался (код ${String(result.status)}, сигнал ${String(result.signal)}):\n` +
                stripSnapshotWarnings(result.stderr ?? ""),
        );
    }
    return result.stderr ?? "";
}

/** Без предупреждений «not yet fully verified» о встроенных модулях: они есть на каждой сборке. */
function stripSnapshotWarnings(stderr) {
    return stderr
        .split("\n")
        .filter(
            (line) =>
                !/not yet fully verified|may still work in some cases|request support for the module|--trace-warnings/.test(line),
        )
        .join("\n")
        .trim();
}

/** Модуль бандла по строке: esbuild пишет `// <путь>` перед каждым модулем. */
function moduleIndex(source) {
    const lines = source.split("\n");
    const starts = [];
    lines.forEach((line, index) => {
        const match = /^\/\/ ((?:src|node_modules)\/\S+)$/.exec(line);
        if (match) starts.push({ line: index + 1, module: match[1] });
    });
    return (line) => {
        let found = "?";
        for (const start of starts) {
            if (start.line > line) break;
            found = start.module;
        }
        return found;
    };
}

/**
 * Проверка 1: ловушки на верхнем уровне. Возвращает нарушения — чтения не из
 * {@link ALLOWED_TOP_LEVEL}, сгруппированные по месту.
 *
 * @param {{ mainPath: string, workDir: string, node?: string }} params
 * @returns {Array<{ what: string, module: string, line: number, code: string, allowed: boolean }>}
 */
export function auditTopLevel({ mainPath, workDir, node = process.execPath }) {
    const prelude = readFileSync(PRELUDE, "utf8");
    const main = readFileSync(mainPath, "utf8");
    const preludeLines = prelude.split("\n").length - 1;
    const entry = join(workDir, "audit-entry.cjs");
    const report = join(workDir, "audit.json");
    writeFileSync(entry, prelude + main);
    buildSnapshot({
        node,
        entry,
        blob: join(workDir, "audit.blob"),
        cwd: workDir,
        env: cleanEnv({ DIODE_SNAPSHOT_AUDIT_OUT: report }),
    });
    const hits = /** @type {Array<{ what: string, stack: string[] }>} */ (JSON.parse(readFileSync(report, "utf8")));
    const lines = main.split("\n");
    const moduleAt = moduleIndex(main);
    const entryFrame = new RegExp(`${escapeRegExp(entry)}:(\\d+):\\d+`);
    /** @type {Map<string, { what: string, module: string, line: number, code: string, allowed: boolean }>} */
    const found = new Map();
    for (const { what, stack } of hits) {
        // stack[0] — сама ловушка в прелюдии, дальше — до первого кадра бандла. Node
        // между ними — это либо наш вызов (`path.resolve` читает cwd, `os.tmpdir` —
        // env), либо его собственная кухня: предупреждения и загрузчик встроенных
        // модулей (`process.pid` в тексте предупреждения). Вторую пропускаем.
        const index = stack.findIndex((f, i) => {
            if (i === 0) return false;
            const match = entryFrame.exec(f);
            return match !== null && Number(match[1]) > preludeLines;
        });
        if (index === -1) continue;
        const frame = stack[index];
        if (stack.slice(1, index).some((f) => /internal\/process\/warning|internal\/main\/mksnapshot|internal\/modules\//.test(f))) {
            continue;
        }
        const line = Number(entryFrame.exec(frame)?.[1]) - preludeLines;
        const module = moduleAt(line);
        const key = `${what}\u0000${module}\u0000${String(line)}`;
        if (found.has(key)) continue;
        const allowed = ALLOWED_TOP_LEVEL.some((a) => a.what === what && a.module === module);
        found.set(key, { what, module, line, code: (lines[line - 1] ?? "").trim().slice(0, 120), allowed });
    }
    return [...found.values()];
}

/**
 * Проверка 2: снапшот `main.cjs`, собранный в отравленном окружении. Возвращает
 * метки, которых в блобе больше, чем в пустом снапшоте того же node, и путь блоба
 * (его же гоняет проверка 3).
 *
 * @param {{ mainPath: string, workDir: string }} params
 * @returns {{ leaks: Array<{ mark: string, value: string, inMain: number, inEmpty: number }>, blob: string, node: string }}
 */
export function findBakedEnvironment({ mainPath, workDir }) {
    // Свой node в каталоге с меткой: execPath сборки тоже окружение (в SEA execPath —
    // сам бинарь, а у сборщика — node).
    const nodeDir = join(workDir, MARKS.execPath);
    mkdirSync(nodeDir, { recursive: true });
    const node = join(nodeDir, basename(process.execPath));
    copyFileSync(process.execPath, node);
    chmodSync(node, 0o755);
    const cwd = join(workDir, MARKS.cwd);
    mkdirSync(cwd, { recursive: true });
    const env = poisonedEnv();

    const empty = join(workDir, "empty.cjs");
    writeFileSync(empty, 'require("node:v8").startupSnapshot.setDeserializeMainFunction(() => {});\n');
    const emptyBlob = join(workDir, "empty.blob");
    const mainBlob = join(workDir, "main.blob");
    buildSnapshot({ node, entry: empty, blob: emptyBlob, cwd, env, extraArgs: [MARKS.argv] });
    // Тот же вход, что у бинаря (build-sea.mjs): main.cjs, скомпилированный eagerly.
    buildSnapshot({
        node,
        entry: SNAPSHOT_ENTRY,
        blob: mainBlob,
        cwd,
        env: { ...env, ...snapshotEntryEnv(mainPath) },
        extraArgs: [MARKS.argv],
    });

    const count = (bytes, mark) => {
        const text = bytes.toString("latin1");
        return text.split(mark).length - 1 + (text.split(Buffer.from(mark, "utf16le").toString("latin1")).length - 1);
    };
    const emptyBytes = readFileSync(emptyBlob);
    const mainBytes = readFileSync(mainBlob);
    const leaks = [];
    for (const [value, mark] of Object.entries(MARKS)) {
        const inMain = count(mainBytes, mark);
        const inEmpty = count(emptyBytes, mark);
        if (inMain > inEmpty) leaks.push({ mark, value, inMain, inEmpty });
    }
    return { leaks, blob: mainBlob, node };
}

/**
 * Проверка 3: поведение после десериализации отравленного блоба в чистом окружении.
 * Возвращает список расхождений (пустой — всё как у пользователя).
 *
 * Запускает обычный `process.execPath` (тот же node, что собирал блоб, но не из
 * каталога с меткой): иначе путь рантайма в тексте ошибки выглядел бы утечкой.
 *
 * @param {{ mainPath: string, blob: string, workDir: string }} params
 * @returns {string[]}
 */
export function checkDeserializedBehaviour({ mainPath, blob, workDir }) {
    const node = process.execPath;
    const problems = [];
    const runHome = join(workDir, "run-home");
    const runTmp = join(workDir, "run-tmp");
    const runCwd = join(workDir, "run-cwd");
    for (const dir of [runHome, runTmp, runCwd]) mkdirSync(dir, { recursive: true });
    const runEnv = cleanEnv({
        HOME: runHome,
        USERPROFILE: runHome,
        TMPDIR: runTmp,
        TMP: runTmp,
        TEMP: runTmp,
        XDG_CONFIG_HOME: join(runHome, ".config"),
        XDG_CACHE_HOME: join(runHome, ".cache"),
        XDG_DATA_HOME: join(runHome, ".local", "share"),
        APPDATA: join(runHome, "AppData", "Roaming"),
        LOCALAPPDATA: join(runHome, "AppData", "Local"),
    });
    // argv[1] у SEA — путь бинаря; здесь — main.cjs, как у `node dist/main.cjs`.
    // `plain` — тот же main.cjs без снапшота: эталон, с которым сверяется вывод.
    const run = (args, extraEnv = {}, { plain = false } = {}) =>
        spawnSync(node, [...(plain ? [] : ["--snapshot-blob", blob]), mainPath, ...args], {
            cwd: runCwd,
            env: { ...runEnv, ...extraEnv },
            encoding: "utf8",
            timeout: 30_000,
        });
    /** Пробник run-as-node: вывод из снапшота обязан совпасть с выводом без него и с `expected`. */
    const probe = (name, args, expected) => {
        const fromSnapshot = run(args, { DIODE_RUN_AS_NODE: "1" });
        const plain = run(args, { DIODE_RUN_AS_NODE: "1" }, { plain: true });
        if (fromSnapshot.status !== 0) problems.push(`${name}: ${describe(fromSnapshot)}`);
        else if (fromSnapshot.stdout !== plain.stdout) {
            problems.push(`${name}: из снапшота ${fromSnapshot.stdout}, без снапшота ${plain.stdout}`);
        } else if (fromSnapshot.stdout !== JSON.stringify(expected)) {
            problems.push(`${name}: видит ${fromSnapshot.stdout}, ожидалось ${JSON.stringify(expected)}`);
        }
        return fromSnapshot;
    };
    const describe = (r) => `код ${String(r.status)}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(stripSnapshotWarnings(r.stderr ?? ""))}`;
    const marked = (text) => Object.values(MARKS).filter((mark) => text.includes(mark));

    const version = run(["--version"]);
    if (version.status !== 0 || version.stdout.trim() === "") problems.push(`--version: ${describe(version)}`);

    // CLI расширений резолвит каталог данных пользователя от HOME запуска.
    const list = run(["--list-extensions"]);
    if (list.status !== 0) problems.push(`--list-extensions: ${describe(list)}`);
    else if (readdirSync(runHome).length === 0) {
        problems.push("--list-extensions не создал данные пользователя в HOME запуска — каталог запечён при сборке?");
    }

    // run-as-node: -e исполняется CJS-модулем в cwd запуска, argv без слота скрипта.
    const evalCode =
        'const os = require("node:os"); process.stdout.write(JSON.stringify({ cwd: process.cwd(), home: os.homedir(), ' +
        'tmp: os.tmpdir(), argv: process.argv.slice(1), filename: __filename, module: typeof module, ' +
        'path: typeof require("node:path").join }));';
    const evalRun = probe("run-as-node -e", ["-e", evalCode, "arg-1"], {
        cwd: runCwd,
        home: runHome,
        tmp: runTmp,
        argv: ["arg-1"],
        filename: join(runCwd, "[eval]"),
        module: "object",
        path: "function",
    });

    // run-as-node: чужой скрипт с относительным require — как language-сервер.
    // `require.main === module` у него false и без снапшота: скрипт грузит import()
    // синтетического модуля (importModule.ts), — эталон тот же.
    const scriptDir = join(workDir, "script");
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(join(scriptDir, "dep.cjs"), "module.exports = 42;\n");
    const script = join(scriptDir, "server.cjs");
    writeFileSync(
        script,
        'process.stdout.write(JSON.stringify({ dep: require("./dep.cjs"), main: require.main === module, ' +
            "argv: process.argv.slice(1), filename: __filename, cwd: process.cwd() }));\n",
    );
    const scriptRun = probe("run-as-node скрипт", [script, "--stdio"], {
        dep: 42,
        main: false,
        argv: [script, "--stdio"],
        filename: script,
        cwd: runCwd,
    });

    // run-as-node: рабочий поток с сетью — фоновый анализ pyright. node до 26.11 в
    // процессе из user-снапшота падал SIGABRT на первом `stream_wrap` в воркере
    // (`shutdown_wrap_template_.IsEmpty()`, nodejs/node#65978).
    const workerScript = join(scriptDir, "worker.cjs");
    writeFileSync(
        workerScript,
        'const { Worker } = require("node:worker_threads");\n' +
            'const w = new Worker(\'require("node:net"); require("node:v8"); require("node:worker_threads").parentPort.postMessage("ok")\', { eval: true });\n' +
            "w.on(\"message\", (m) => { process.stdout.write(JSON.stringify({ worker: m })); process.exit(0); });\n",
    );
    const workerRun = probe("run-as-node воркер с node:net", [workerScript], { worker: "ok" });

    for (const [name, r] of [
        ["run-as-node воркер", workerRun],
        ["--version", version],
        ["--list-extensions", list],
        ["run-as-node -e", evalRun],
        ["run-as-node скрипт", scriptRun],
    ]) {
        const leaked = marked(`${r.stdout ?? ""}${r.stderr ?? ""}`);
        if (leaked.length > 0) problems.push(`${name}: в выводе окружение сборки (${leaked.join(", ")})`);
    }
    return problems;
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Собирает `main.cjs` во временный каталог тем же tsup, что и релиз. */
function buildMain(outDir) {
    const tsupCli = join(repoRoot, "node_modules", "tsup", "dist", "cli-default.js");
    execFileSync(process.execPath, [tsupCli, "--out-dir", outDir, "--silent"], { stdio: "inherit", cwd: repoRoot });
    return join(outDir, "main.cjs");
}

async function main() {
    const { values } = parseArgs({ options: { main: { type: "string" } } });
    const workDir = mkdtempSync(join(tmpdir(), "diode-snapshot-check-"));
    let failed = false;
    try {
        const mainPath = values.main === undefined ? buildMain(join(workDir, "dist")) : resolve(values.main);
        if (!existsSync(mainPath)) throw new Error(`нет ${mainPath}`);

        const findings = auditTopLevel({ mainPath, workDir: mkdirIn(workDir, "audit") });
        const violations = findings.filter((f) => !f.allowed);
        for (const f of findings.filter((f) => f.allowed)) console.log(`  разрешено: ${f.what} — ${f.module}`);
        if (violations.length > 0) {
            failed = true;
            console.error("Верхний уровень модулей читает окружение — при сборке снапшота оно запечётся:");
            for (const v of violations) console.error(`  ${v.what} — ${v.module} (main.cjs:${String(v.line)}): ${v.code}`);
        }

        const poisonDir = mkdirIn(workDir, "poison");
        const { leaks, blob } = findBakedEnvironment({ mainPath, workDir: poisonDir });
        if (leaks.length > 0) {
            failed = true;
            console.error("Окружение сборки запеклось в кучу снапшота (метки в блобе сверх пустого снапшота):");
            for (const l of leaks) console.error(`  ${l.value}: ${l.mark} — ${String(l.inMain)} против ${String(l.inEmpty)}`);
        }

        const problems = checkDeserializedBehaviour({ mainPath, blob, workDir: mkdirIn(workDir, "run") });
        if (problems.length > 0) {
            failed = true;
            console.error("После десериализации снапшот ведёт себя не так, как у пользователя:");
            for (const p of problems) console.error(`  ${p}`);
        }

        if (failed) {
            console.error("Правила верхнего уровня — docs/arch/Common.md («Верхний уровень модулей и V8-снапшот»).");
            process.exitCode = 1;
        } else {
            console.log("Снапшот ядра собирается; окружение сборки не запекается; после десериализации — окружение запуска.");
        }
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

function mkdirIn(parent, name) {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    return dir;
}

if (process.argv[1] === import.meta.filename) await main();
