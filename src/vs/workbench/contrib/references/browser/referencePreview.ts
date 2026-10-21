import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreReference } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { ITextMatch } from "../../../services/search/common/textSearch.ts";

/** Форма файл-группы поиска: строки рисуют те же `buildFileRow`/`buildMatchRow`. */
export interface IReferenceGroup {
    readonly absolutePath: string;
    /** Разделители `/`. */
    readonly relPath: string;
    readonly matches: ITextMatch[];
}

/**
 * Сначала открытая модель: несохранённые правки сервер видит через didChange, и колонки иначе
 * разъедутся. Потом диск.
 */
export interface IReferenceTextSource {
    /** `null` — файл не открыт. */
    openText(uri: Uri): string | null;
    /** Бросает, если ресурс недоступен. */
    readText(uri: Uri): Promise<string>;
}

/**
 * Ссылка в минифицированном или lock-файле иначе тащит в строку списка сотни килобайт
 * (docs/TODO/SearchPerformance.md, случай 1). `before` режет `trimBefore` при отрисовке.
 */
const MAX_AFTER_CHARS = 256;

/**
 * Порядок групп — первое появление файла в ответе (у tsserver: объявление, затем употребления).
 * Файл читается один раз за запрос; ссылка, чья строка вышла за текст, отбрасывается.
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
        return null;
    }
}

function splitLines(text: string): string[] {
    return text.split("\n").map((line) => line.replace(/\r$/u, ""));
}

/**
 * Колонки LSP — code unit'ы UTF-16, ровно те, в которых режется JS-строка. Многострочный диапазон
 * подсвечивается до конца первой строки.
 */
function toTextMatch(lines: readonly string[], range: IRange): ITextMatch | null {
    // Не `.at()`: номер строки приходит от провайдера, и на отрицательном `.at()` отсчитал бы с конца
    // файла. Чтение по индексу даёт undefined и за краем — тип об этом молчит.
    const line = lines[range.start.line] as string | undefined;
    if (line === undefined) return null;

    const startColumn = Math.min(range.start.character, line.length);
    const endColumn = range.end.line === range.start.line ? Math.min(range.end.character, line.length) : line.length;

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

/** Близнец `labelFor` панели поиска: абсолютный путь съел бы всю ширину узкого сайдбара. */
function labelFor(absolutePath: string, root: string): string {
    // Пустой корень — папка не открыта (файл из CLI): путь показываем как есть,
    // иначе `startsWith("")` съел бы ведущий слэш.
    const rest = root !== "" && absolutePath.startsWith(root) ? absolutePath.slice(root.length) : null;
    // Сосед с общим префиксом («/work/project2» при корне «/work/project») внутри
    // корня не лежит: остаток обязан начинаться с разделителя.
    // Stryker disable next-line Regex: ветка берётся только когда `rest` начинается с разделителя, поэтому якорь `^` на результат не влияет
    // Stryker disable next-line ConditionalExpression: `rest !== null` — быстрый выход; без него регексп проверил бы строку "null", не нашёл разделителя и ушёл в ту же ветку `absolutePath`
    const rel = rest !== null && /^[/\\]/u.test(rest) ? rest.replace(/^[/\\]+/u, "") : absolutePath;
    return rel.replace(/\\/gu, "/");
}
