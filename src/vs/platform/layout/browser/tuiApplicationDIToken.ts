import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";

import { token } from "../../instantiation/common/diContainer.ts";

/**
 * The running tuidom application (root of the UI tree). The type lives in
 * `@tuidom/core`, which declares no DI tokens, so the token sits at the lowest
 * layer allowed to — the analogue of vscode's `ILayoutService` container.
 */
// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TuiApplicationDIToken = token<TuiApplication>("TuiApplication");
