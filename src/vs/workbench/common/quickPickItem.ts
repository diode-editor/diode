/**
 * Providers extend the item structurally with their own fields (`QuickAccessItem.accept`, an absolute
 * file path), so the widget must carry the item as is, without rebuilding it.
 */
export interface QuickPickItem {
    /** Nerd font icon character (e.g. a file icon like ""). */
    icon?: string;
    label: string;
    description?: string;
    shortcut?: string;
    hint?: string;
    badge?: string;
    /** Byte-offset ranges in `label` to highlight as fuzzy-match hits. */
    labelMatchRanges?: readonly [number, number][];
    /** Byte-offset ranges in `description` to highlight as fuzzy-match hits. */
    descriptionMatchRanges?: readonly [number, number][];
}

/** `error` blocks Enter. */
export type ValidationSeverity = "error" | "warning" | "info";

/** `"item"` accepts the list row, `"value"` accepts the typed text (the InputBox flavor). */
export type QuickPickAcceptMode = "item" | "value";
