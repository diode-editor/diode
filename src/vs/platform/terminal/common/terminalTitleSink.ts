import { token } from "../../instantiation/common/diContainer.ts";

/** Порт: `setWindowTitle` есть у конкретных бэкендов, а не у `ITerminalBackend`; связывает владелец бэкенда (`main.ts`). */
export type ITerminalTitleSink = (title: string) => void;

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TerminalTitleSinkDIToken = token<ITerminalTitleSink>("TerminalTitleSink");
