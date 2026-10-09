// Терминал на pty расширения, который заводит не само расширение, а ядро —
// терминал задачи с `CustomExecution` (`customPtyImplementation` в
// `_createTerminal` эталона `terminalTaskSystem.ts`). Процесс (pty) субпроцесс
// подключает позже, по id инстанса, когда узнает о старте задачи
// (`attachPtyToTerminal` эталона); вывод, ввод и размер идут тем же мостом
// `terminal.pty.*`, что у `window.createTerminal({ pty })`. Реализация —
// мост терминалов расширений (`ExtensionTerminalAdapter`), он есть только
// при extension host'е.

import type { TerminalWaitOnExit } from "../browser/terminalService.ts";

export interface IExtensionPtyTerminalOptions {
    readonly name: string;
    /** Строка до вывода pty (`initialText` эталона — «Executing task: …»). */
    readonly message?: string;
    readonly waitOnExit?: TerminalWaitOnExit;
}

export interface IExtensionPtyTerminals {
    /** Завести инстанс с эмулятором под pty расширения; результат — id инстанса. */
    createPtyInstance(options: IExtensionPtyTerminalOptions): number;
}
