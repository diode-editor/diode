import type { FuzzyMatch, PreparedQuery } from "../../../../base/common/fuzzySearch.ts";
import { fuzzyMatchPrepared, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import type { ICommandSnapshot } from "../../../../platform/commands/common/commandRegistry.ts";
import { findConflictingBindings } from "../../../../platform/keybinding/common/keybindingConflicts.ts";
import type {
    IKeybindingEntrySnapshot,
    KeybindingChord,
    KeybindingSource,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    type KeybindingLabelStyle,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";

/**
 * Строка на КАЖДУЮ запись {@link IKeybindingEntrySnapshot} (у команды с двумя биндингами — две строки)
 * плюс строки команд без биндинга, как в VS Code.
 */
export interface IKeybindingItem {
    readonly commandId: string;
    /** У биндинга неизвестной команды — её id. */
    readonly title: string;
    /** `null` — команда без биндинга (показывается «—»). */
    readonly chord: KeybindingChord | null;
    readonly when: string | undefined;
    readonly source: KeybindingSource | null;
    readonly hasConflict: boolean;
}

export interface IFilteredKeybindingItem {
    readonly item: IKeybindingItem;
    readonly titleMatch: FuzzyMatch | null;
}

export function buildKeybindingItems(
    bindings: readonly IKeybindingEntrySnapshot[],
    commands: readonly ICommandSnapshot[],
): IKeybindingItem[] {
    const titles = new Map(commands.map((command) => [command.id, command.title]));
    const bound = new Set<string>();
    const conflicting = findConflictingBindings(bindings);

    const items: IKeybindingItem[] = bindings.map((entry, index) => {
        bound.add(entry.commandId);
        return {
            commandId: entry.commandId,
            title: titles.get(entry.commandId) ?? entry.commandId,
            chord: entry.chord,
            when: entry.when,
            source: entry.source,
            hasConflict: conflicting.has(index),
        };
    });

    for (const command of commands) {
        if (bound.has(command.id)) continue;
        items.push({
            commandId: command.id,
            title: command.title,
            chord: null,
            when: undefined,
            source: null,
            hasConflict: false,
        });
    }

    // Сортировка по title (дальше по id — у биндинга неизвестной команды title
    // и есть id), чтобы биндинги одной команды стояли рядом.
    return items.sort((a, b) => a.title.localeCompare(b.title) || a.commandId.localeCompare(b.commandId));
}

interface IParsedQuery {
    readonly source: KeybindingSource | null;
    readonly conflictsOnly: boolean;
    readonly text: string;
}

// Partial: ключ — произвольное слово запроса, и «не фильтр» — штатный исход.
const SOURCE_FILTERS: Partial<Record<string, KeybindingSource>> = {
    "@source:default": "default",
    "@source:extension": "extension",
    "@source:user": "user",
};

function parseQuery(query: string): IParsedQuery {
    let source: KeybindingSource | null = null;
    let conflictsOnly = false;
    const rest: string[] = [];
    // Stryker disable next-line Regex: вид разделителя тут не наблюдаем — лишние пробелы и пустые токены прореживает prepareQuery ниже, а не этот сплит.
    for (const word of query.split(/\s+/)) {
        const filter = SOURCE_FILTERS[word.toLowerCase()];
        if (filter !== undefined) source = filter;
        else if (word.toLowerCase() === "@conflicts") conflictsOnly = true;
        else rest.push(word);
    }
    // Пробел обязателен: остаток запроса едет в prepareQuery, который режет его
    // на термы по пробелам — склейка в одно слово сузила бы выдачу.
    return { source, conflictsOnly, text: rest.join(" ") };
}

/** На маке — ещё и по словам («cmd+s», «option»): глиф «⌘» с клавиатуры не набрать. */
function matchesKeyLabel(query: PreparedQuery, chord: KeybindingChord, style: KeybindingLabelStyle): boolean {
    const labels =
        style === "mac"
            ? [formatKeybinding(chord, "mac"), formatKeybinding(chord, "macWords")]
            : [formatKeybinding(chord, style)];
    return labels.some((label) => fuzzyMatchPrepared(query, label) !== null);
}

/**
 * Как `BASENAME_BONUS` файлового пикера: совпасть в том, что пользователь читает, важнее, чем в id.
 * Совпадение только по подписи комбинации очков не приносит и оседает в хвосте.
 */
const TITLE_MATCH_BONUS = 200;

interface IRankedKeybindingItem {
    readonly entry: IFilteredKeybindingItem;
    readonly score: number;
}

function passesPrefixFilters(item: IKeybindingItem, parsed: IParsedQuery): boolean {
    if (parsed.source !== null && item.source !== parsed.source) return false;
    if (parsed.conflictsOnly && !item.hasConflict) return false;
    return true;
}

/**
 * `@source:`/`@conflicts` — точный отбор, остальное — fuzzy по title, id и подписи биндинга; подсветка —
 * только для совпадения по title. Выдача ранжируется: иначе точное совпадение по подписи тонет среди
 * команд, чьи термы нашлись в id («Show Hover» vs `editor.action.showPrevParameterHint`). Сортировка
 * стабильная — строки одной команды держатся рядом.
 */
export function filterKeybindingItems(
    items: readonly IKeybindingItem[],
    query: string,
    style: KeybindingLabelStyle = "pc",
): IFilteredKeybindingItem[] {
    const parsed = parseQuery(query);
    const candidates = items.filter((item) => passesPrefixFilters(item, parsed));
    const prepared = prepareQuery(parsed.text);
    if (prepared.terms.length === 0) return candidates.map((item) => ({ item, titleMatch: null }));

    const ranked: IRankedKeybindingItem[] = [];
    for (const item of candidates) {
        const titleMatch = fuzzyMatchPrepared(prepared, item.title);
        if (titleMatch !== null) {
            ranked.push({ entry: { item, titleMatch }, score: titleMatch.score + TITLE_MATCH_BONUS });
            continue;
        }
        const idMatch = fuzzyMatchPrepared(prepared, item.commandId);
        if (idMatch !== null) {
            ranked.push({ entry: { item, titleMatch: null }, score: idMatch.score });
            continue;
        }
        if (item.chord !== null && matchesKeyLabel(prepared, item.chord, style)) {
            ranked.push({ entry: { item, titleMatch: null }, score: 0 });
        }
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.map((rankedItem) => rankedItem.entry);
}
