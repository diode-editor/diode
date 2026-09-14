/**
 * Призрачная подсказка (ghost text, VS Code inline suggest): фантомный текст,
 * которого НЕТ в документе — рисуется серым за кареткой как предпросмотр
 * вставки. Первая строка (`lines[0]`) дорисовывается в хвост строки `line`
 * после колонки `character`; остальные строки занимают view zones под ней
 * (upstream-аналог — injected text + AdditionalLinesWidget в ghostTextView.ts).
 */
export interface IGhostText {
    /** Логическая строка документа, на которой стоит подсказка. */
    readonly line: number;
    /** Смещение в строке (0-based), с которого начинается фантомный текст. */
    readonly character: number;
    /** Строки подсказки; первая — хвост строки каретки, остальные — зоны. */
    readonly lines: readonly string[];
}

/** Поэлементное сравнение — гейт no-op в `EditorElement.setGhostText`. */
export function ghostTextEquals(a: IGhostText | null, b: IGhostText | null): boolean {
    if (a === null || b === null) return a === b;
    return (
        a.line === b.line &&
        a.character === b.character &&
        a.lines.length === b.lines.length &&
        a.lines.every((text, i) => text === b.lines[i])
    );
}
