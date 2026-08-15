// Фабрика сессий встроенного терминала — это шов для тестов: юнит-тесты подменяют
// фабрику на FakeTerminalSurface и не спавнят реальные PTY. Прод-биндинг (реальный
// EmbeddedTerminalSession) навешивается на уровне DI-модулей отдельно.

import type { IDisposable } from "@tuidom/core/common/disposable";
import type { ITerminalSurface } from "@tuidom/core/common/iTerminalSurface";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export interface ITerminalSessionOptions {
    cols: number;
    rows: number;
    shell?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
}

export type TerminalSessionFactory = (options: ITerminalSessionOptions) => ITerminalSurface & IDisposable;

export const TerminalSessionFactoryDIToken = token<TerminalSessionFactory>("TerminalSessionFactory");
