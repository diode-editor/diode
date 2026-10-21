// Терминал на pty расширения, который заводит ядро, — терминал задачи с `CustomExecution`
// (`customPtyImplementation` эталона). Pty субпроцесс подключает позже, по id инстанса
// (`attachPtyToTerminal` эталона); реализация есть только при extension host'е.

import type { TerminalWaitOnExit } from "../browser/terminalService.ts";

export interface IExtensionPtyTerminalOptions {
    readonly name: string;
    /** Строка до вывода pty (`initialText` эталона — «Executing task: …»). */
    readonly message?: string;
    readonly waitOnExit?: TerminalWaitOnExit;
}

export interface IExtensionPtyTerminals {
    /** Результат — id инстанса. */
    createPtyInstance(options: IExtensionPtyTerminalOptions): number;
}
