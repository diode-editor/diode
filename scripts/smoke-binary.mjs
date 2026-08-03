/**
 * Самотест собранного бинаря: он должен **реально стартовать**.
 *
 * Без шебанга сознательно: файл импортируется из тестов, а vitest на Windows
 * инлайнит его через esbuild transform, который (в отличие от bundle) шебанг НЕ
 * срезает — `#!` остаётся в ESM-выводе и падает как SyntaxError. Скрипт всё равно
 * запускается через `node scripts/…`, так что шебанг тут не нужен.
 *
 * История вопроса (#143): предыдущая версия проверки смотрела только на
 * `result.error` от `spawnSync` и запускала бинарь без аргументов. Segfault
 * на Intel macOS даёт `error === undefined`, `status === null`, `signal === "SIGSEGV"`,
 * поэтому крах логировался как «spawn OK, exited with code null» — и битый ассет
 * уехал в релиз. Плюс запуск без аргументов и в норме даёт exit 1 («Usage»),
 * так что по коду возврата отличить краш от нормы было нельзя.
 *
 * Отсюда контракт: `<bin> --version` → `signal === null`, `status === 0`, непустой stdout.
 * `--version` выбран потому, что это единственная ветка, которая гарантированно
 * завершается сама и не требует TTY.
 *
 * Оговорка: `--version` отрабатывает до `createDefaultAssetAccess()`, поэтому самотест
 * ловит краш до `main()`, но не битый `vexx.bundle` — за это отвечают e2e.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * @param {string} binaryPath Абсолютный путь к собранному бинарю.
 * @param {{ timeoutMs?: number, cwd?: string }} [options]
 * @returns {string} Напечатанная бинарём версия (trimmed).
 * @throws {Error} Если бинарь не запустился, упал по сигналу или вернул != 0.
 */
export function smokeTestBinary(binaryPath, options = {}) {
    const { timeoutMs = 30_000, cwd } = options;
    const result = spawnSync(binaryPath, ["--version"], {
        timeout: timeoutMs,
        stdio: "pipe",
        encoding: "utf8",
        ...(cwd !== undefined ? { cwd } : {}),
    });

    if (result.error) {
        throw new Error(`[smoke] Binary cannot be executed (${result.error.code ?? "?"}): ${result.error.message}`);
    }
    if (result.signal !== null) {
        // Ровно этот случай и есть #143: SIGSEGV в статических инициализаторах до main().
        throw new Error(
            `[smoke] Binary crashed with signal ${result.signal} — it does not start at all.\n` +
                `${describeOutput(result)}`,
        );
    }
    if (result.status !== 0) {
        throw new Error(`[smoke] Binary exited with code ${String(result.status)}, expected 0.\n${describeOutput(result)}`);
    }

    const version = (result.stdout ?? "").trim();
    if (version === "") {
        throw new Error(`[smoke] Binary printed no version on stdout.\n${describeOutput(result)}`);
    }
    return version;
}

/** @param {{ stdout?: string, stderr?: string }} result */
function describeOutput(result) {
    return `  stdout: ${JSON.stringify(result.stdout ?? "")}\n  stderr: ${JSON.stringify(result.stderr ?? "")}`;
}

/**
 * Самотест node-режима (`VEXX_RUN_AS_NODE=1`): бинарь обязан исполнять внешний
 * JS как node — на этом стоит запуск вшитого language-сервера (SEA-поставка
 * без node в PATH). Проверяются обе механики загрузки: CJS через createRequire
 * и динамический `import()` ESM с top-level await из внешнего CJS-шима
 * (embedder-хук SEA перехватывает только import из вшитого main — runAsNode.ts).
 *
 * @param {string} binaryPath Абсолютный путь к собранному бинарю.
 * @param {{ timeoutMs?: number }} [options]
 * @throws {Error} Если node-режим не исполняет скрипты или вывод не совпал.
 */
export function smokeTestNodeMode(binaryPath, options = {}) {
    const { timeoutMs = 30_000 } = options;
    const dir = mkdtempSync(join(tmpdir(), "vexx-smoke-node-"));
    try {
        writeFileSync(
            join(dir, "inner.mjs"),
            'await new Promise((r) => setTimeout(r, 1));\nconsole.log("SMOKE-ESM-TLA-OK");\n',
        );
        writeFileSync(
            join(dir, "probe.cjs"),
            '"use strict";\nconsole.log("SMOKE-CJS-OK");\nconst { pathToFileURL } = require("node:url");\nconst { join } = require("node:path");\nimport(pathToFileURL(join(__dirname, "inner.mjs")).href).catch((e) => { console.error(e); process.exit(1); });\n',
        );
        const result = spawnSync(binaryPath, [join(dir, "probe.cjs")], {
            timeout: timeoutMs,
            stdio: "pipe",
            encoding: "utf8",
            env: { ...process.env, VEXX_RUN_AS_NODE: "1" },
        });
        if (result.error) {
            throw new Error(`[smoke:node] cannot execute (${result.error.code ?? "?"}): ${result.error.message}`);
        }
        if (result.signal !== null || result.status !== 0) {
            throw new Error(
                `[smoke:node] exited status=${String(result.status)} signal=${String(result.signal)}.\n` +
                    describeOutput(result),
            );
        }
        const out = result.stdout ?? "";
        if (!out.includes("SMOKE-CJS-OK") || !out.includes("SMOKE-ESM-TLA-OK")) {
            throw new Error(`[smoke:node] unexpected output.\n${describeOutput(result)}`);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
