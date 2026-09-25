#!/usr/bin/env node
/**
 * Генерирует `src/vs/base/common/codicons.generated.ts` — таблицу
 * «имя codicon'а → символ шрифта» из upstream `microsoft/vscode`.
 *
 * Зачем она нужна: расширения пишут в статус-бар текст вида `$(check) Ready`,
 * и без таблицы в полосе повиснет литерал `$(check)`. Кодпоинты живут в
 * приватной области Unicode (nerd-font/codicon), их нельзя ни вывести, ни
 * угадать — только взять у upstream. Поэтому файл генерируемый: ручная копия
 * из 700 строк протухнет на первом же обновлении пина.
 *
 * Источник — два файла upstream:
 *   - `src/vs/base/common/codiconsLibrary.ts` — сама таблица (генерируется у них
 *     из microsoft/vscode-codicons);
 *   - `src/vs/base/common/codicons.ts` — производные имена (`codiconsDerived`),
 *     часть которых ссылается на имя из библиотеки, а не на кодпоинт.
 *
 * Пин тега согласован с `extensions/VSCODE_VERSION` и `scripts/import-vscode-dts.mjs`
 * — держите их в лок-степе.
 *
 * Режимы:
 *   (без флагов) — перегенерировать файл (требует сети: git clone);
 *   --check      — сверить, что файл в репозитории равен свежесгенерированному
 *                  (drift guard, требует сети). Exit 1 при расхождении.
 *
 * Usage: node scripts/import-codicons.mjs [--check]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const VSCODE_TAG = "1.127.0";
const VSCODE_REPO = "https://github.com/microsoft/vscode.git";
const LIBRARY_PATH = "src/vs/base/common/codiconsLibrary.ts";
const DERIVED_PATH = "src/vs/base/common/codicons.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const targetFile = resolve(repoRoot, "src", "vs", "base", "common", "codicons.generated.ts");

function fetchUpstream() {
    const scratch = mkdtempSync(join(tmpdir(), "vscode-codicons-"));
    const cloneDir = join(scratch, "vscode");
    try {
        console.error(`[codicons] cloning microsoft/vscode@${VSCODE_TAG} (sparse, blobless)`);
        execFileSync(
            "git",
            [
                "clone",
                "--depth",
                "1",
                "--filter=blob:none",
                "--sparse",
                "--branch",
                VSCODE_TAG,
                VSCODE_REPO,
                cloneDir,
            ],
            { stdio: ["ignore", "ignore", "inherit"] },
        );
        execFileSync("git", ["-C", cloneDir, "sparse-checkout", "set", "--no-cone", LIBRARY_PATH, DERIVED_PATH], {
            stdio: ["ignore", "ignore", "inherit"],
        });
        const commit = execFileSync("git", ["-C", cloneDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        return {
            commit,
            library: readFileSync(join(cloneDir, LIBRARY_PATH), "utf8"),
            derived: readFileSync(join(cloneDir, DERIVED_PATH), "utf8"),
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

/**
 * Разбирает `register('<имя>', 0x<кодпоинт> | '<другое имя>')` в порядке
 * появления. Ссылка по имени резолвится в уже разобранный кодпоинт — ровно
 * как это делает `codiconsUtil.register` у upstream.
 */
function parseRegistrations(source, into) {
    const re = /register\(\s*'([a-z0-9-]+)'\s*,\s*(0x[0-9a-fA-F]+|'[a-z0-9-]+')\s*\)/gu;
    for (const match of source.matchAll(re)) {
        const [, name, value] = match;
        if (value.startsWith("0x")) {
            into.set(name, Number.parseInt(value, 16));
            continue;
        }
        const referenced = into.get(value.slice(1, -1));
        if (referenced === undefined) {
            throw new Error(`[codicons] ${name} ссылается на неизвестный codicon ${value}`);
        }
        into.set(name, referenced);
    }
}

function render(entries, commit) {
    const lines = [
        "// Таблица codicon'ов VS Code: имя → символ шрифта.",
        "//",
        `// Сгенерировано scripts/import-codicons.mjs из microsoft/vscode@${VSCODE_TAG}`,
        `// (commit ${commit}), файлы src/vs/base/common/codicons{,Library}.ts.`,
        "// Руками не править — правьте генератор и перезапускайте его.",
        "//",
        "// Символы лежат в приватной области Unicode: нарисует их только шрифт с",
        "// codicon'ами (nerd-font), как и остальные глифы интерфейса Diode.",
        "",
        "/** Имя codicon'а (`$(check)`) → символ шрифта; неизвестное имя даёт `undefined`. */",
        "export const CODICON_GLYPHS: Readonly<Partial<Record<string, string>>> = {",
    ];
    for (const [name, codepoint] of entries) {
        const escaped = `\\u${codepoint.toString(16).padStart(4, "0")}`;
        // Кавычки только там, где имя не идентификатор (у codicon'ов это дефис) —
        // так же, как их расставил бы prettier (quoteProps: as-needed).
        const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) ? name : JSON.stringify(name);
        lines.push(`    ${key}: "${escaped}",`);
    }
    lines.push("};", "");
    return lines.join("\n");
}

const upstream = fetchUpstream();
const registrations = new Map();
parseRegistrations(upstream.library, registrations);
parseRegistrations(upstream.derived, registrations);
if (registrations.size === 0) throw new Error("[codicons] upstream не дал ни одной записи — формат изменился?");

const generated = render([...registrations].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)), upstream.commit);

if (process.argv.includes("--check")) {
    const current = readFileSync(targetFile, "utf8");
    if (current !== generated) {
        console.error("[codicons] дрейф: src/vs/base/common/codicons.generated.ts не равен upstream-таблице");
        process.exit(1);
    }
    console.error(`[codicons] ok: ${registrations.size} записей совпадают с upstream@${VSCODE_TAG}`);
} else {
    writeFileSync(targetFile, generated);
    console.error(`[codicons] записано ${registrations.size} записей в ${targetFile}`);
}
