import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreReference } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { ITextMatch } from "../../../services/search/common/textSearch.ts";

/**
 * Ссылки одного файла с текстом строк — то, что показывает панель REFERENCES.
 * Форма совпадает с файл-группой поиска: строки списка рисуют те же
 * `buildFileRow`/`buildMatchRow`, которым нужен `ITextMatch` с предразрезанным
 * превью.
 */
export interface IReferenceGroup {
    readonly absolutePath: string;
    /** Путь относительно корня воркспейса с разделителями `/` — метка строки файла. */
    readonly relPath: string;
    readonly matches: ITextMatch[];
}

/**
 * Откуда брать текст файла со ссылкой. LSP отдаёт только `uri` + `range`, а
 * показать надо саму строку кода, поэтому источник двухступенчатый: сначала
 * открытая модель (в ней видны несохранённые правки — сервер их тоже видит
 * через didChange, иначе колонки разъедутся), потом диск.
 */
export interface IReferenceTextSource {
    /** Текст ресурса из открытой модели; `null` — файл не открыт ни в одной вкладке. */
    openText(uri: Uri): string | null;
    /** Текст ресурса с диска; бросает, если ресурс недоступен. */
    readText(uri: Uri): Promise<string>;
}

/**
 * Хвост строки за матчем каппится у истока: одна ссылка в минифицированном или
 * lock-файле иначе тащит в строку списка сотни килобайт
 * (docs/TODO/SearchPerformance.md, случай 1). `before` не каппим — его режет
 * `trimBefore` уже при отрисовке.
 */
const MAX_AFTER_CHARS = 256;

/**
 * Собирает ссылки в файл-группы с текстом строк. Порядок групп — порядок
 * первого появления файла в ответе провайдеров (у tsserver он уже осмысленный:
 * объявление, затем употребления); внутри группы порядок ссылок сохраняется.
 *
 * Каждый файл читается один раз за запрос. Ссылка, чей файл исчез или чья
 * строка вышла за пределы текста (файл поменялся, пока сервер думал),
 * отбрасывается — пустая группа в панель не попадает.
 */
export async function buildReferenceGroups(
    references: readonly ICoreReference[],
    source: IReferenceTextSource,
    root: string,
): Promise<IReferenceGroup[]> {
    const groups = new Map<string, IReferenceGroup>();
    const lineCache = new Map<string, readonly string[] | null>();

    for (const reference of references) {
        const lines = await linesOf(reference.uri, source, lineCache);
        if (lines === null) continue;
        const match = toTextMatch(lines, reference.range);
        if (match === null) continue;

        let group = groups.get(reference.uri);
        if (group === undefined) {
            const absolutePath = Uri.parse(reference.uri).fsPath;
            group = { absolutePath, relPath: labelFor(absolutePath, root), matches: [] };
            groups.set(reference.uri, group);
        }
        group.matches.push(match);
    }

    return [...groups.values()];
}

/** Строки файла из кэша запроса; `null` — файл прочитать не удалось. */
async function linesOf(
    uri: string,
    source: IReferenceTextSource,
    cache: Map<string, readonly string[] | null>,
): Promise<readonly string[] | null> {
    const cached = cache.get(uri);
    if (cached !== undefined) return cached;
    const lines = await readLines(uri, source);
    cache.set(uri, lines);
    return lines;
}

async function readLines(uri: string, source: IReferenceTextSource): Promise<readonly string[] | null> {
    const parsed = Uri.parse(uri);
    const open = source.openText(parsed);
    if (open !== null) return splitLines(open);
    try {
        return splitLines(await source.readText(parsed));
    } catch {
        // Файл исчез или недоступен — его ссылки просто не показываем.
        return null;
    }
}

function splitLines(text: string): string[] {
    return text.split("\n").map((line) => line.replace(/\r$/u, ""));
}

/**
 * Превращает диапазон ссылки в матч со строкой кода. Колонки LSP — это
 * code-unit-оффсеты UTF-16, то есть ровно те, в которых режется JS-строка.
 * Многострочный диапазон (редкость, но провайдер вправе) подсвечивается до
 * конца первой строки.
 */
function toTextMatch(lines: readonly string[], range: IRange): ITextMatch | null {
    const line = lines[range.start.line];
    if (line === undefined) return null;

    const startColumn = Math.min(range.start.character, line.length);
    const endColumn =
        range.end.line === range.start.line ? Math.min(range.end.character, line.length) : line.length;

    return {
        // Номер строки — 1-based, как у ripgrep: строки списка общие с поиском.
        lineNumber: range.start.line + 1,
        startColumn,
        endColumn,
        preview: {
            before: line.slice(0, startColumn),
            inside: line.slice(startColumn, endColumn),
            after: capAfter(line.slice(endColumn)),
        },
    };
}

function capAfter(after: string): string {
    if (after.length <= MAX_AFTER_CHARS) return after;
    // Не разрываем суррогатную пару: половинка пары рисуется как U+FFFD.
    let cut = MAX_AFTER_CHARS;
    const lead = after.charCodeAt(cut - 1);
    if (lead >= 0xd800 && lead <= 0xdbff) cut--;
    return after.slice(0, cut);
}

/**
 * Путь относительно корня воркспейса с разделителями `/` — близнец `labelFor`
 * панели поиска: абсолютный путь съел бы всю ширину узкого сайдбара.
 */
function labelFor(absolutePath: string, root: string): string {
    // Пустой корень — папка не открыта (файл из CLI): путь показываем как есть,
    // иначе `startsWith("")` съел бы ведущий слэш.
    const rest = root !== "" && absolutePath.startsWith(root) ? absolutePath.slice(root.length) : null;
    // Сосед с общим префиксом («/work/project2» при корне «/work/project») внутри
    // корня не лежит: остаток обязан начинаться с разделителя.
    // Stryker disable next-line Regex: ветка берётся только когда `rest` начинается с разделителя (проверка строкой выше), поэтому якорь `^` на результат не влияет
    const rel = rest !== null && /^[/\\]/u.test(rest) ? rest.replace(/^[/\\]+/u, "") : absolutePath;
    return rel.replace(/\\/gu, "/");
}
