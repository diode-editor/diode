#!/usr/bin/env node
/**
 * Раскладывает отчёт бенча открытия файла в ветку данных `bench-data`
 * (её checkout — `--out`). Зовёт `.github/workflows/bench.yml` после прогона;
 * руками — чтобы положить локальный отчёт рядом с CI-шными.
 *
 *   node scripts/bench-publish.mjs --report out/open.json --md out/BENCH-OPEN.md --out ../bench-data
 *
 * Раскладка ветки (читает страница сайта diode-editor.github.io/benchmarks/):
 *
 *   README.md                       что это за ветка
 *   open/index.json                 список прогонов, новые в конец — точка входа для страницы
 *   open/<дата>-<коммит>.json       сырой отчёт прогона (FullReport из e2e/bench/openReport.ts)
 *   open/latest.json                копия последнего отчёта
 *   open/latest.md                  он же в Markdown (то, что раньше шло в docs/public/BENCH-OPEN.md)
 *
 * Дата и коммит — из самого отчёта (`generatedAt`, `commit`), чтобы имя файла не
 * зависело от часов машины, на которой раскладывали. Повторная раскладка того же
 * отчёта перезаписывает файл и не дублирует запись в индексе.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BRANCH_README = `# bench-data

Ветка данных бенчмарков Diode. Пишет её джоба \`.github/workflows/bench.yml\`
(раз в неделю и по кнопке) через \`scripts/bench-publish.mjs\`; руками сюда не коммитят.
История нужна странице <https://diode-editor.github.io/benchmarks/> — она читает
\`open/index.json\` и сырые отчёты отсюда через raw.githubusercontent.com.

- \`open/index.json\` — список прогонов (новые в конце);
- \`open/<дата>-<коммит>.json\` — отчёт прогона, формат — \`FullReport\` из \`e2e/bench/openReport.ts\`;
- \`open/latest.json\`, \`open/latest.md\` — последний прогон.

Методика и что меряется — \`docs/public/BENCH-OPEN.md\` в \`main\`.
`;

function parseArgs(argv) {
    const args = { report: null, md: null, out: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`${arg}: нужен аргумент`);
            return v;
        };
        if (arg === "--report") args.report = value();
        else if (arg === "--md") args.md = value();
        else if (arg === "--out") args.out = value();
        else throw new Error(`неизвестный аргумент: ${arg}`);
    }
    for (const key of ["report", "md", "out"]) {
        if (args[key] === null) throw new Error(`--${key} обязателен`);
    }
    return args;
}

/** Имя файла прогона: `<YYYY-MM-DD>-<коммит>.json` из полей отчёта. */
export function runFileName(report) {
    const date = String(report.generatedAt).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error(`generatedAt не похож на ISO-дату: ${String(report.generatedAt)}`);
    const commit = String(report.commit)
        .replace(/[^0-9a-f]/gi, "")
        .slice(0, 12);
    if (commit === "") throw new Error(`commit пустой: ${String(report.commit)}`);
    return `${date}-${commit}.json`;
}

/** Запись индекса: ровно то, что нужно странице, чтобы выбрать прогон, не читая его. */
export function indexEntry(report, file) {
    return {
        file,
        generatedAt: report.generatedAt,
        commit: report.commit,
        binaryVersion: report.binaryVersion,
        ci: report.env?.ci === true,
        conditions: report.env?.conditions ?? "",
        sizes: report.sizes.map((s) => s.key),
    };
}

/** Добавляет запись в индекс; тот же файл — заменяет запись на месте. */
export function upsertIndex(entries, entry) {
    const next = entries.filter((e) => e.file !== entry.file);
    const at = entries.findIndex((e) => e.file === entry.file);
    if (at >= 0) next.splice(at, 0, entry);
    else next.push(entry);
    return next;
}

export function publish({ reportJson, markdown, outDir }) {
    const report = JSON.parse(reportJson);
    const openDir = join(outDir, "open");
    mkdirSync(openDir, { recursive: true });

    const file = runFileName(report);
    writeFileSync(join(openDir, file), reportJson.endsWith("\n") ? reportJson : reportJson + "\n");
    writeFileSync(join(openDir, "latest.json"), reportJson.endsWith("\n") ? reportJson : reportJson + "\n");
    writeFileSync(join(openDir, "latest.md"), markdown);

    const indexPath = join(openDir, "index.json");
    const entries = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
    const updated = upsertIndex(entries, indexEntry(report, file));
    writeFileSync(indexPath, JSON.stringify(updated, null, 2) + "\n");

    const readmePath = join(outDir, "README.md");
    if (!existsSync(readmePath)) writeFileSync(readmePath, BRANCH_README);
    return { file, runs: updated.length };
}

if ((process.argv[1] ?? "").endsWith("bench-publish.mjs")) {
    const args = parseArgs(process.argv.slice(2));
    const result = publish({
        reportJson: readFileSync(args.report, "utf8"),
        markdown: readFileSync(args.md, "utf8"),
        outDir: args.out,
    });
    console.log(`[bench-publish] ${result.file} → ${args.out}/open (прогонов в индексе: ${String(result.runs)})`);
}
