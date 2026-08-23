/**
 * Модель строки quick pick.
 *
 * Живёт у нас, а не в движке: поля — понятия Diode (fuzzy-совпадения провайдера,
 * шорткат команды, бейдж «недавнее»), а `@tuidom/elements` держит только виджеты
 * общего назначения (docs/arch/Workbench.md, «Где живёт Element»).
 *
 * Провайдеры расширяют предмет структурно и вешают на него свои поля
 * (`QuickAccessItem.accept`, абсолютный путь файла) — виджет обязан носить
 * предмет целиком, не пересобирая его.
 */
export interface QuickPickItem {
    /** Nerd font icon character (e.g. a file icon like ""). */
    icon?: string;
    /** Main display text. */
    label: string;
    /** Right-side text: file path, category, etc. */
    description?: string;
    /** Keyboard shortcut shown right-aligned, e.g. "Ctrl+Shift+P". */
    shortcut?: string;
    /** Action hint shown after description, e.g. "Configure Binding". */
    hint?: string;
    /** Marker badge, e.g. "recently used". */
    badge?: string;
    /** Byte-offset ranges in `label` to highlight as fuzzy-match hits. */
    labelMatchRanges?: readonly [number, number][];
    /** Byte-offset ranges in `description` to highlight as fuzzy-match hits. */
    descriptionMatchRanges?: readonly [number, number][];
}

/** Насколько сообщение под строкой запроса «строгое»; error блокирует Enter. */
export type ValidationSeverity = "error" | "warning" | "info";

/**
 * Как трактовать Enter:
 *   "item"  — принять строку списка (Quick Open, палитра команд);
 *   "value" — принять введённый текст (флейвор InputBox).
 */
export type QuickPickAcceptMode = "item" | "value";
