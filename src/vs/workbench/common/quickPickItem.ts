/**
 * Провайдеры расширяют предмет структурно своими полями (`QuickAccessItem.accept`,
 * абсолютный путь файла) — виджет обязан носить предмет целиком, не пересобирая его.
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

/** `error` блокирует Enter. */
export type ValidationSeverity = "error" | "warning" | "info";

/** `"item"` — принять строку списка, `"value"` — введённый текст (флейвор InputBox). */
export type QuickPickAcceptMode = "item" | "value";
