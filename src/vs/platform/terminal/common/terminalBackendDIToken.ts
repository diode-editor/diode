import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";

import { token } from "../../instantiation/common/diContainer.ts";

// Тип живёт в `@tuidom/core`, который токенов не объявляет, — токен в platform.
// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TerminalBackendDIToken = token<ITerminalBackend>("TerminalBackend");
