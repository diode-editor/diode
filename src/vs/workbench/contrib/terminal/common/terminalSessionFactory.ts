// Фабрика сессий встроенного терминала — это шов для тестов: юнит-тесты подменяют
// фабрику на FakeTerminalSurface и не спавнят реальные PTY. Прод-биндинг (реальный
// EmbeddedTerminalSession) навешивается на уровне DI-модулей отдельно.

import type { ITerminalSurface } from "@tuidom/core/common/iTerminalSurface";

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
    /**
     * Строка, напечатанная в эмулятор до вывода шелла, с переводом строки
     * (`TerminalOptions.message`, `initialText` эталона); в шелл не уходит.
     */
    message?: string;
}

/**
 * Сессия встроенного терминала: поверхность для отрисовки плюс запущенный шелл
 * (`shell` — по нему вкладка получает заголовок; какой шелл запускать, решает
 * node-слой, `getSystemShell`; `pid` — его процесс).
 */
export type ITerminalSession = ITerminalSurface &
    IDisposable & {
        readonly shell: string;
        /** Pid процесса шелла; `undefined`, если процесса на нашей стороне нет. */
        readonly pid: number | undefined;
    };

export type TerminalSessionFactory = (options: ITerminalSessionOptions) => ITerminalSession;

export const TerminalSessionFactoryDIToken = token<TerminalSessionFactory>("TerminalSessionFactory");
