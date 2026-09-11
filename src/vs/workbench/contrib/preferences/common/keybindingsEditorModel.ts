import type { ICommandSnapshot } from "../../../../platform/commands/common/commandRegistry.ts";
import type {
    IKeybindingEntrySnapshot,
    KeybindingChord,
    KeybindingSource,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { FuzzyMatch } from "../../../../base/common/fuzzySearch.ts";
import { fuzzyMatchBest } from "../../../../base/common/fuzzySearch.ts";

/**
 * Модель вкладки Keyboard Shortcuts: чистые функции без DI — состав строк из
 * снапшотов реестров и фильтрация по запросу. Строка на КАЖДУЮ запись
 * {@link IKeybindingEntrySnapshot} (у команды с двумя биндингами — две строки)
 * плюс строки команд без биндинга (как в VS Code).
 */
export interface IKeybindingItem {
    readonly commandId: string;
    /** Человекочитаемый title команды; у биндинга неизвестной команды — её id. */
    readonly title: string;
    /** `null` — команда без биндинга (показывается «—»). */
    readonly chord: KeybindingChord | null;
    readonly when: string | undefined;
    /** `null` — у строки без биндинга источника нет. */
    readonly source: KeybindingSource | null;
}

/** Строка после фильтра; `titleMatch` — для посимвольной подсветки title. */
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

    const items: IKeybindingItem[] = bindings.map((entry) => {
        bound.add(entry.commandId);
        return {
            commandId: entry.commandId,
            title: titles.get(entry.commandId) ?? entry.commandId,
            chord: entry.chord,
            when: entry.when,
            source: entry.source,
        };
    });

    for (const command of commands) {
        if (bound.has(command.id)) continue;
        items.push({ commandId: command.id, title: command.title, chord: null, when: undefined, source: null });
    }

    // Сортировка по title (дальше по id — у биндинга неизвестной команды title
    // и есть id), чтобы биндинги одной команды стояли рядом.
    return items.sort((a, b) => a.title.localeCompare(b.title) || a.commandId.localeCompare(b.commandId));
}

/** Префикс-фильтры запроса (`@source:user`) — срезаются до fuzzy-части. */
interface IParsedQuery {
    readonly source: KeybindingSource | null;
    readonly text: string;
}

const SOURCE_FILTERS: Record<string, KeybindingSource> = {
    "@source:default": "default",
    "@source:extension": "extension",
    "@source:user": "user",
};

function parseQuery(query: string): IParsedQuery {
    let source: KeybindingSource | null = null;
    const rest: string[] = [];
    for (const word of query.trim().split(/\s+/)) {
        const filter = SOURCE_FILTERS[word.toLowerCase()];
        if (filter !== undefined) source = filter;
        else rest.push(word);
    }
    return { source, text: rest.join(" ") };
}

/**
 * Фильтр списка: `@source:` — точный отбор по источнику, остальное — fuzzy по
 * title, id команды и display-форме биндинга. Подсветка возвращается только для
 * совпадения по title: подсвечивать колонку клавиш по fuzzy-огрызку — шум.
 */
export function filterKeybindingItems(items: readonly IKeybindingItem[], query: string): IFilteredKeybindingItem[] {
    const parsed = parseQuery(query);
    const result: IFilteredKeybindingItem[] = [];
    for (const item of items) {
        if (parsed.source !== null && item.source !== parsed.source) continue;
        if (parsed.text === "") {
            result.push({ item, titleMatch: null });
            continue;
        }
        const titleMatch = fuzzyMatchBest(parsed.text, item.title);
        if (titleMatch !== null) {
            result.push({ item, titleMatch });
            continue;
        }
        const idMatch = fuzzyMatchBest(parsed.text, item.commandId);
        const keyMatch = item.chord !== null ? fuzzyMatchBest(parsed.text, formatKeybinding(item.chord)) : null;
        if (idMatch !== null || keyMatch !== null) result.push({ item, titleMatch: null });
    }
    return result;
}
