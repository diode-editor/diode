export interface IUndoRedoElement {
    readonly label: string;
    /** Не ключ истории: бакет — аргумент `pushElement(element, context)`. У безымянного буфера пуст. */
    readonly resources: readonly string[];
    /** Задано — откат деструктивен (удалит созданные вставкой файлы): текст подтверждения, гейт `explorer.confirmUndo`. */
    readonly confirmBeforeUndo?: string;
    /**
     * Нет — откатывать можно всегда. Нужно шагу нескольких документов: после него могли
     * набрать текст в одном из них. `false` — отказ, шаг остаётся в стеке. Промис — ответ
     * с диска (шаг правил закрытый файл: откат, только если на диске ровно записанное).
     */
    canUndo?(): boolean | Promise<boolean>;
    canRedo?(): boolean | Promise<boolean>;
    undo(): void | Promise<void>;
    redo(): void | Promise<void>;
}
