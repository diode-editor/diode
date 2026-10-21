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
 * A row for EACH {@link IKeybindingEntrySnapshot} entry (a command with two bindings gets two rows)
 * plus rows for commands without a binding, as in VS Code.
 */
export interface IKeybindingItem {
    readonly commandId: string;
    /** For a binding of an unknown command — its id. */
    readonly title: string;
    /** `null` — a command without a binding (shown as "—"). */
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

    // Sort by title (then by id — for a binding of an unknown command the title
    // is the id) so bindings of the same command stay together.
    return items.sort((a, b) => a.title.localeCompare(b.title) || a.commandId.localeCompare(b.commandId));
}

interface IParsedQuery {
    readonly source: KeybindingSource | null;
    readonly conflictsOnly: boolean;
    readonly text: string;
}

// Partial: the key is an arbitrary query word, and "not a filter" is a normal outcome.
const SOURCE_FILTERS: Partial<Record<string, KeybindingSource>> = {
    "@source:default": "default",
    "@source:extension": "extension",
    "@source:user": "user",
};

function parseQuery(query: string): IParsedQuery {
    let source: KeybindingSource | null = null;
    let conflictsOnly = false;
    const rest: string[] = [];
    // Stryker disable next-line Regex: the separator shape is unobservable here — extra spaces and empty tokens are thinned out by prepareQuery below, not by this split.
    for (const word of query.split(/\s+/)) {
        const filter = SOURCE_FILTERS[word.toLowerCase()];
        if (filter !== undefined) source = filter;
        else if (word.toLowerCase() === "@conflicts") conflictsOnly = true;
        else rest.push(word);
    }
    // The space is required: the query remainder goes to prepareQuery, which splits it
    // into terms by spaces — gluing into one word would narrow the results.
    return { source, conflictsOnly, text: rest.join(" ") };
}

/** On mac also by words ("cmd+s", "option"): the "⌘" glyph can't be typed on a keyboard. */
function matchesKeyLabel(query: PreparedQuery, chord: KeybindingChord, style: KeybindingLabelStyle): boolean {
    const labels =
        style === "mac"
            ? [formatKeybinding(chord, "mac"), formatKeybinding(chord, "macWords")]
            : [formatKeybinding(chord, style)];
    return labels.some((label) => fuzzyMatchPrepared(query, label) !== null);
}

/**
 * Like the file picker's `BASENAME_BONUS`: matching what the user reads matters more than matching the id.
 * A match only on the key combination label earns no points and sinks to the tail.
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
 * `@source:`/`@conflicts` are exact selection, the rest is fuzzy over title, id and binding label; highlight is
 * only for a title match. Results are ranked: otherwise an exact label match drowns among
 * commands whose terms were found in the id ("Show Hover" vs `editor.action.showPrevParameterHint`). The sort
 * is stable — rows of the same command stay together.
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
