import type { ITerminalSurface } from "@tuidom/core/common/iTerminalSurface";

import type { Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export interface ITerminalSessionOptions {
    cols: number;
    rows: number;
    shell?: string;
    args?: string[];
    cwd?: string;
    /** Поверх унаследованного окружения; `null` снимает переменную (`TerminalOptions.env`). */
    env?: Record<string, string | null>;
    /** `true` — окружение шелла ровно `env`, без наследования от процесса (`TerminalOptions.strictEnv`). */
    strictEnv?: boolean;
    /** Печатается в эмулятор до вывода шелла (`initialText` эталона); в шелл не уходит. */
    message?: string;
}

export type ITerminalRelaunchOptions = Omit<ITerminalSessionOptions, "cols" | "rows"> & {
    /** Очистить буфер эмулятора перед новым процессом (`presentation.clear` задачи). */
    clear?: boolean;
};

export type ITerminalSession = ITerminalSurface &
    IDisposable & {
        readonly shell: string;
        /** `undefined` — процесса на нашей стороне нет (pty расширения). */
        readonly pid: number | undefined;
        /**
         * Процесс уже вышел — новый в том же эмуляторе (`reuseTerminal` эталона). Pty расширения
         * шелловые поля пропускает: новый процесс подключит расширение.
         */
        relaunch(options: ITerminalRelaunchOptions): void;
        /** В процесс текст не уходит. */
        printMessage(text: string): void;
        /** Индексы 0..15; перекрашивает и уже выведенное. */
        setAnsiColors(ansi: readonly number[]): void;
        /** Клавиша «press any key to close» (`waitOnExit` эталона). */
        readonly onDidInputAfterExit: Event<void>;
    };

export type TerminalSessionFactory = (options: ITerminalSessionOptions) => ITerminalSession;

export const TerminalSessionFactoryDIToken = token<TerminalSessionFactory>("TerminalSessionFactory");

/** Процессом владеет расширение (`window.createTerminal({ pty })`): на нашей стороне только эмулятор. */
export interface IExtensionPtySession extends ITerminalSession {
    feed(data: string): void;
    exit(code: number | undefined): void;
}

export interface IExtensionPtySessionOptions {
    cols: number;
    rows: number;
    /** Имя терминала — им сессия представляется вместо шелла (`shell`). */
    name: string;
    onInput(data: string): void;
    onResize(cols: number, rows: number): void;
}

export type ExtensionPtySessionFactory = (options: IExtensionPtySessionOptions) => IExtensionPtySession;

export const ExtensionPtySessionFactoryDIToken = token<ExtensionPtySessionFactory>("ExtensionPtySessionFactory");
