import { getLocation } from "jsonc-parser";

/** Half-open `[start, end)` offsets into the document text. */
export interface IOffsetRange {
    readonly start: number;
    readonly end: number;
}

/** Caret sits where a setting key goes. */
export interface ISettingsKeyContext {
    readonly kind: "key";
    readonly replaceRange: IOffsetRange;
}

/** Caret sits in the value slot of `key`. */
export interface ISettingsValueContext {
    readonly kind: "value";
    readonly key: string;
    readonly replaceRange: IOffsetRange;
}

export type SettingsCompletionContext = ISettingsKeyContext | ISettingsValueContext | null;

/** Characters that make up a settings key or a bare literal (mirrors the core's completion prefix). */
const TOKEN_CHAR = /[\w.-]/;

/**
 * Classifies the caret inside a `settings.json` for completion: is a key expected
 * here, or a value (and for which key), and what exactly should be replaced.
 *
 * `null` means "not our business" — nested objects, array elements, or anywhere
 * the caret isn't a top-level entry of the settings map.
 *
 * Uses `jsonc-parser`'s `getLocation`, which is error-tolerant: while the user
 * types, the document is almost always invalid JSON.
 */
export function getSettingsCompletionContext(text: string, offset: number): SettingsCompletionContext {
    const location = getLocation(text, offset);

    // settings.json is a flat map — only top-level entries carry schema. Nested
    // objects (e.g. `terminal.capabilities: { … }`) have a longer path; stay out.
    if (location.path.length !== 1) return null;

    const replaceRange = tokenRangeAt(text, offset);
    if (location.isAtPropertyKey) return { kind: "key", replaceRange };

    const key = location.path[0];
    if (typeof key !== "string" || key === "") return null;
    return { kind: "value", key, replaceRange };
}

/**
 * The span the completion should overwrite: the token under the caret, plus the
 * quotes around it when it is a quoted string.
 *
 * Computed by scanning rather than read off the parse tree on purpose —
 * `getLocation().previousNode` disappears exactly in the half-typed states that
 * matter (`{ edi`, `"x": t`), because they are not valid JSON yet.
 *
 * Including the quotes is what keeps them from doubling up: the provider inserts
 * `"editor.tabSize"` over `"edi"`, not next to it.
 */
function tokenRangeAt(text: string, offset: number): IOffsetRange {
    let start = offset;
    while (start > 0 && TOKEN_CHAR.test(text[start - 1])) start--;
    const quoted = start > 0 && text[start - 1] === '"';
    if (quoted) start--;

    let end = offset;
    while (end < text.length && TOKEN_CHAR.test(text[end])) end++;
    if (quoted && text[end] === '"') end++;

    return { start, end };
}

/** `{line, character}` (0-based) → offset into `text`. Clamped to the text length. */
export function positionToOffset(text: string, line: number, character: number): number {
    let offset = 0;
    for (let i = 0; i < line; i++) {
        const nl = text.indexOf("\n", offset);
        if (nl === -1) return text.length;
        offset = nl + 1;
    }
    return Math.min(offset + character, text.length);
}

/** Offset into `text` → `{line, character}` (0-based). */
export function offsetToPosition(text: string, offset: number): { line: number; character: number } {
    const clamped = Math.min(Math.max(offset, 0), text.length);
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < clamped; i++) {
        if (text[i] === "\n") {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, character: clamped - lineStart };
}
