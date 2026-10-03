import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";

import { token } from "../../instantiation/common/diContainer.ts";

/**
 * The tuidom terminal backend (raw I/O with the host terminal). The type lives
 * in `@tuidom/core`, which declares no DI tokens, so the token sits in platform.
 */
// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TerminalBackendDIToken = token<ITerminalBackend>("TerminalBackend");
