import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";

import { token } from "../../instantiation/common/diContainer.ts";

// Тип живёт в `@tuidom/core`, который токенов не объявляет, — токен в нижнем разрешённом слое.
// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const TuiApplicationDIToken = token<TuiApplication>("TuiApplication");
