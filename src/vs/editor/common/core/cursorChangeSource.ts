/**
 * Источник текущей смены каретки/выделения — «что за жест сейчас исполняется».
 *
 * Зачем: `vscode.window.onDidChangeTextEditorSelection` несёт
 * `TextEditorSelectionChangeKind` (Keyboard / Mouse / Command), а наш
 * `EditorViewState.selections` — обычный сеттер, у которого писателей много
 * (набор, мышь, команды, undo, find, расширения) и ни один из них не
 * представляется. Тащить «причину» параметром через всю цепочку
 * `selections =` → `onDidChangeCursorPosition` → `EditorComponent` →
 * `EditorService` → мост расширений значило бы менять пять сигнатур ради поля,
 * которое читает один потребитель.
 *
 * Вместо этого источник объявляется **областью** вокруг обработчика жеста
 * ({@link withCursorChangeSource}), а читается синхронно тем, кто ловит
 * событие смены выделения ({@link currentCursorChangeSource}). Это работает
 * ровно потому, что вся цепочка от жеста до слушателя синхронная: сеттер
 * `selections` зовёт слушателей немедленно, изнутри обработчика.
 *
 * Границы честности:
 * - область **синхронная**. Команда, двигающая каретку в промисе (`await`),
 *   выедет из области, и её смена приедет как «источник неизвестен».
 * - размечены только жесты, у которых источник очевиден (ввод и мышь в
 *   редакторе, диспетчер кейбиндов, команда от расширения). Всё остальное
 *   (undo/redo, find, фолдинг, программные правки) даёт `undefined` — upstream
 *   это разрешает: `TextEditorSelectionChangeEvent.kind` объявлен
 *   `TextEditorSelectionChangeKind | undefined`.
 */
export type CursorChangeSource = "keyboard" | "mouse" | "command";

let currentSource: CursorChangeSource | undefined;

/**
 * Источник жеста, который исполняется прямо сейчас; `undefined` — вызов пришёл
 * не из размеченной области. Читать имеет смысл только синхронно, внутри
 * обработчика смены выделения.
 */
export function currentCursorChangeSource(): CursorChangeSource | undefined {
    return currentSource;
}

/**
 * Исполняет `fn`, объявив источник смены каретки на время его синхронного
 * выполнения. Вложенность сохраняет внешний источник: кейбинд, запустивший
 * команду, остаётся `keyboard` — как в VS Code, где стрелка даёт `Keyboard`, а
 * не `Command`.
 */
export function withCursorChangeSource<T>(source: CursorChangeSource, fn: () => T): T {
    const previous = currentSource;
    // Внешняя область выигрывает: `keyboard` (кейбинд) не должен деградировать
    // в `command` на вложенном исполнении команды.
    currentSource = previous ?? source;
    try {
        return fn();
    } finally {
        currentSource = previous;
    }
}
