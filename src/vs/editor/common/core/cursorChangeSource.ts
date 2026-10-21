/**
 * Источник жеста для `TextEditorSelectionChangeKind`. Не параметр через пять
 * сигнатур, а **синхронная область** вокруг обработчика жеста: цепочка от
 * жеста до слушателя смены выделения синхронна. Смена каретки после `await`
 * выедет из области и даст `undefined` — upstream это допускает (`kind` у
 * `TextEditorSelectionChangeEvent` опционален).
 */
export type CursorChangeSource = "keyboard" | "mouse" | "command";

let currentSource: CursorChangeSource | undefined;

/** Читать только синхронно, внутри обработчика смены выделения. */
export function currentCursorChangeSource(): CursorChangeSource | undefined {
    return currentSource;
}

/**
 * Вложенность сохраняет внешний источник: кейбинд, запустивший команду,
 * остаётся `keyboard` — как в VS Code.
 */
export function withCursorChangeSource<T>(source: CursorChangeSource, fn: () => T): T {
    const previous = currentSource;
    currentSource = previous ?? source;
    try {
        return fn();
    } finally {
        currentSource = previous;
    }
}
