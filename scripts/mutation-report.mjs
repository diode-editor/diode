#!/usr/bin/env node
/**
 * Превращает `reports/mutation/mutation.json` в markdown для комментария в PR
 * и для тикета ночного прогона.
 *
 * Смысл отчёта — выжившие мутанты: это места, где код можно испортить, и ни один
 * тест не заметит. Убитых не перечисляем — их сотни, и они означают, что всё хорошо.
 *
 * Показываем не «мутатор → замена», а настоящий diff строки: `ConditionalExpression
 * → true` не говорит читателю ничего, пока он не откроет файл и не найдёт место.
 * Исходник берём из самого отчёта (`files[].source`) — он там есть целиком,
 * поэтому рендер не зависит от того, откуда запущен скрипт и что сейчас в дереве.
 *
 * Мутанты со статусом `Ignored` в знаменатель балла не входят — так же, как
 * исключения покрытия. Их два разных вида, и различаются они только причиной:
 * погашенные `// Stryker disable` (решение автора, видно в ревью) и пропущенные
 * флагом `--ignoreStatic` (решение прогона).
 *
 * Использование: node scripts/mutation-report.mjs [<путь к mutation.json>]
 * Ссылки на строки появляются, если заданы GITHUB_REPOSITORY и MUTATION_SHA.
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const reportPath = process.argv[2] ?? path.join(repoRoot, "reports", "mutation", "mutation.json");

if (!existsSync(reportPath)) {
    console.error(`Отчёта нет: ${reportPath}`);
    process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));

/** Порог из конфига — чтобы отчёт не расходился с тем, по чему падает гейт. */
function breakThreshold() {
    try {
        const config = JSON.parse(readFileSync(path.join(repoRoot, "stryker.config.json"), "utf8"));
        return config.thresholds?.break ?? null;
    } catch {
        return null;
    }
}

const threshold = breakThreshold();
const repo = process.env.GITHUB_REPOSITORY ?? "";
const sha = process.env.MUTATION_SHA ?? "";
const canLink = repo !== "" && sha !== "";

/** Сколько выживших расписываем подробно и в какой бюджет символов укладываемся. */
const DETAIL_LIMIT = 40;
// Комментарий в GitHub обрезается на 65536 символах; берём с запасом, чтобы
// хвост отчёта («показано N из M») точно уместился.
const CHAR_BUDGET = 55_000;
/** Многострочный мутант (вырезанное тело функции) режем — целиком он бесполезен. */
const SNIPPET_LINES = 3;

function lineLink(file, line) {
    if (!canLink) return `строка ${line}`;
    return `[строка ${line}](https://github.com/${repo}/blob/${sha}/${file}#L${line})`;
}

/**
 * Собирает «до/после» для мутанта: берёт строки исходника, которые он накрывает,
 * и подменяет в них ровно диапазон [start, end).
 */
function renderDiff(source, mutant) {
    const lines = source.split("\n");
    const { start, end } = mutant.location;
    const first = start.line - 1;
    const last = end.line - 1;
    if (first < 0 || last >= lines.length) return null;

    const original = lines.slice(first, last + 1);
    const head = lines[first].slice(0, start.column - 1);
    const tail = lines[last].slice(end.column - 1);
    const mutated = `${head}${String(mutant.replacement ?? "")}${tail}`.split("\n");

    const clip = (arr) =>
        arr.length > SNIPPET_LINES ? [...arr.slice(0, SNIPPET_LINES), "…"] : arr;

    return { original: clip(original), mutated: clip(mutated) };
}

const survivors = [];
let killed = 0;
let silenced = 0; // погашены `// Stryker disable` — осознанное решение автора
let skippedStatic = 0; // пропущены `--ignoreStatic` — решение прогона, не автора
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
                if (/ignoreStatic/.test(mutant.statusReason ?? "")) skippedStatic++;
                else silenced++;
                break;
            case "NoCoverage":
                noCoverage++;
                survivors.push({ file, mutant, source: data.source, uncovered: true });
                break;
            case "Survived":
                survivors.push({ file, mutant, source: data.source, uncovered: false });
                break;
            default:
                break;
        }
    }
}

const scored = total - silenced - skippedStatic;
const detected = killed + timeout;
const score = scored === 0 ? 100 : (detected / scored) * 100;
const passing = threshold === null || score >= threshold;

const out = [];

out.push(`### ${passing ? "✅" : "❌"} Мутационный балл — ${score.toFixed(2)}%`);
out.push("");
out.push("| | |");
out.push("|---|--:|");
out.push(`| Убито | ${detected} |`);
out.push(`| **Выжило** | **${survivors.length - noCoverage}** |`);
if (noCoverage > 0) out.push(`| Не покрыто ни одним тестом | ${noCoverage} |`);
if (silenced > 0) out.push(`| Погашено \`// Stryker disable\` | ${silenced} |`);
if (skippedStatic > 0) out.push(`| Пропущено как статические | ${skippedStatic} |`);
out.push(`| Всего мутантов | ${total} |`);
out.push("");

if (threshold !== null && !passing) {
    out.push(`Порог — ${threshold}%. Каждого выжившего либо убиваем тестом, либо гасим`);
    out.push("`// Stryker disable next-line <мутатор>: причина` — и причина едет в ревью.");
    out.push("");
}

if (skippedStatic > 0) {
    out.push(
        `> Статические мутанты (${skippedStatic}) пропущены: это верхнеуровневый код — таблицы, ` +
            `регистрации команд, — который не сужается per-test покрытием и потому слишком дорог ` +
            `для PR-гейта. Их проверяет ночной прогон, так что балл выше не потому, что дыр нет, ` +
            `а потому что эту часть смотрели не здесь.`,
    );
    out.push("");
}

if (survivors.length === 0) {
    out.push("Выживших нет — каждую внесённую поломку кто-то из тестов заметил.");
} else {
    const byFile = new Map();
    for (const entry of survivors) {
        if (!byFile.has(entry.file)) byFile.set(entry.file, []);
        byFile.get(entry.file).push(entry);
    }
    const sorted = [...byFile].sort((a, b) => b[1].length - a[1].length);
    // Внутри файла — по порядку строк: читатель идёт по коду сверху вниз, а не
    // в том порядке, в каком Stryker их сгенерировал.
    for (const [, entries] of sorted) {
        entries.sort(
            (a, b) =>
                a.mutant.location.start.line - b.mutant.location.start.line ||
                a.mutant.location.start.column - b.mutant.location.start.column,
        );
    }

    let shown = 0;
    let budget = CHAR_BUDGET;
    let truncated = false;

    for (const [file, entries] of sorted) {
        if (truncated) break;
        const block = [];
        // В заголовке — сколько мест требует внимания: выжившие и непокрытые
        // вместе, потому что в списке ниже они идут вперемешку по номерам строк.
        const uncoveredHere = entries.filter((e) => e.uncovered).length;
        const detail =
            uncoveredHere > 0 && uncoveredHere < entries.length
                ? ` (${entries.length - uncoveredHere} выжило, ${uncoveredHere} не покрыто)`
                : "";
        block.push(
            `<details${sorted.length === 1 ? " open" : ""}><summary><code>${file}</code> — ${entries.length}${detail}</summary>`,
        );
        block.push("");

        // Считаем отдельно: блок может не влезть в бюджет и быть отброшен целиком,
        // и тогда его записи в общий счётчик попасть не должны — иначе «расписано N»
        // завысит правду ровно там, где честность и нужна.
        let shownInBlock = 0;
        for (const { mutant, source, uncovered } of entries) {
            if (shown + shownInBlock >= DETAIL_LIMIT) {
                truncated = true;
                break;
            }
            const diff = renderDiff(source, mutant);
            const mark = uncovered ? " · не покрыт ни одним тестом" : "";
            block.push(
                `**${lineLink(file, mutant.location.start.line)}** · \`${mutant.mutatorName}\`${mark}`,
            );
            block.push("");
            if (diff === null) {
                block.push(`\`→ ${String(mutant.replacement ?? "").slice(0, 120)}\``);
            } else {
                block.push("```diff");
                for (const line of diff.original) block.push(`- ${line}`);
                for (const line of diff.mutated) block.push(`+ ${line}`);
                block.push("```");
            }
            block.push("");
            shownInBlock++;
        }

        block.push("</details>");
        block.push("");

        const text = block.join("\n");
        if (shownInBlock === 0 || text.length > budget) {
            truncated = true;
            break;
        }
        budget -= text.length;
        shown += shownInBlock;
        out.push(text);
    }

    // Молча обрезанный список читался бы как «вот и всё» — говорим, сколько скрыли.
    if (truncated || shown < survivors.length) {
        out.push(
            `_Расписано ${shown} из ${survivors.length}. Остальные — в HTML-отчёте из артефактов прогона._`,
        );
        out.push("");
        out.push("<details><summary>Все файлы с выжившими</summary>");
        out.push("");
        for (const [file, entries] of sorted) out.push(`- \`${file}\` — ${entries.length}`);
        out.push("");
        out.push("</details>");
    }
}

console.log(out.join("\n"));
