#!/usr/bin/env node
/**
 * Превращает `reports/mutation/mutation.json` в markdown для тикета ночного
 * мутационного прогона.
 *
 * Смысл отчёта — выжившие мутанты: это места, где код можно испортить, и ни один
 * тест не заметит. Убитые не перечисляем, их сотни и они означают, что всё хорошо.
 *
 * Мутанты со статусом `Ignored` (погашенные `// Stryker disable` с причиной)
 * в знаменатель балла не входят — так же, как исключения покрытия.
 *
 * Использование: node scripts/mutation-report.mjs [<путь к mutation.json>]
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const reportPath =
    process.argv[2] ?? path.join(repoRoot, "reports", "mutation", "mutation.json");

if (!existsSync(reportPath)) {
    console.error(`Отчёта нет: ${reportPath}`);
    process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));

/** Сколько выживших показываем целиком; остальные — счётчиком по файлам. */
const DETAIL_LIMIT = 60;

const survivors = [];
let killed = 0;
let ignored = 0;
let noCoverage = 0;
let timeout = 0;
let total = 0;

for (const [file, data] of Object.entries(report.files)) {
    for (const mutant of data.mutants) {
        total++;
        switch (mutant.status) {
            case "Killed":
                killed++;
                break;
            case "Timeout":
                timeout++;
                break;
            case "Ignored":
                ignored++;
                break;
            case "NoCoverage":
                noCoverage++;
                survivors.push({ file, mutant, uncovered: true });
                break;
            case "Survived":
                survivors.push({ file, mutant, uncovered: false });
                break;
            default:
                break;
        }
    }
}

// Балл считается по мутантам, которые реально тестировались: Ignored в знаменатель
// не входят — иначе гашение эквивалентного мутанта портило бы метрику.
const scored = total - ignored;
const detected = killed + timeout;
const score = scored === 0 ? 100 : (detected / scored) * 100;

const byFile = new Map();
for (const entry of survivors) {
    if (!byFile.has(entry.file)) byFile.set(entry.file, []);
    byFile.get(entry.file).push(entry);
}
const filesSorted = [...byFile].sort((a, b) => b[1].length - a[1].length);

const out = [];
out.push(`**Мутационный балл: ${score.toFixed(2)}%**`);
out.push("");
out.push(
    `Мутантов ${total}: убито ${killed}, таймаут ${timeout}, **выжило ${survivors.length - noCoverage}**, ` +
        `не покрыто ${noCoverage}, погашено \`// Stryker disable\` ${ignored}.`,
);
out.push("");

if (survivors.length === 0) {
    out.push("Выживших нет — каждую внесённую поломку кто-то из тестов заметил.");
} else {
    out.push(
        "Ниже — места, где код можно испортить незаметно для тестов. " +
            "Не каждый выживший требует теста: эквивалентного мутанта убить нельзя, " +
            "его гасят `// Stryker disable next-line <мутатор>: причина`.",
    );
    out.push("");

    let shown = 0;
    for (const [file, entries] of filesSorted) {
        out.push(`### \`${file}\` — ${entries.length}`);
        out.push("");
        for (const { mutant, uncovered } of entries) {
            if (shown >= DETAIL_LIMIT) break;
            shown++;
            const line = mutant.location.start.line;
            const mark = uncovered ? " _(не покрыт ни одним тестом)_" : "";
            out.push(
                `- строка ${line}, \`${mutant.mutatorName}\` → \`${String(mutant.replacement ?? "").slice(0, 120)}\`${mark}`,
            );
        }
        out.push("");
        if (shown >= DETAIL_LIMIT) break;
    }

    // Молча обрезанный список читался бы как «вот и всё» — говорим, сколько скрыли.
    if (survivors.length > shown) {
        out.push(
            `_Показаны ${shown} из ${survivors.length}. Полный список — в HTML-отчёте из артефактов прогона._`,
        );
        out.push("");
        const rest = filesSorted
            .map(([file, entries]) => `- \`${file}\` — ${entries.length}`)
            .join("\n");
        out.push("<details><summary>Все файлы с выжившими</summary>");
        out.push("");
        out.push(rest);
        out.push("");
        out.push("</details>");
    }
}

console.log(out.join("\n"));
