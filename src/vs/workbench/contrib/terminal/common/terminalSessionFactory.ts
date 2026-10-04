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
    env?: Record<string, string>;
}

/**
 * Сессия встроенного терминала: поверхность для отрисовки плюс запущенный шелл
 * (`shell` — по нему вкладка получает заголовок; какой шелл запускать, решает
 * node-слой, `getSystemShell`).
 */
export type ITerminalSession = ITerminalSurface & IDisposable & { readonly shell: string };

export type TerminalSessionFactory = (options: ITerminalSessionOptions) => ITerminalSession;

export const TerminalSessionFactoryDIToken = token<TerminalSessionFactory>("TerminalSessionFactory");
