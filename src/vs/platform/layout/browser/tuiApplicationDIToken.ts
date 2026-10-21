import type { TuiApplication } from "@tuidom/core/dom/tuiApplication";

import { token } from "../../instantiation/common/diContainer.ts";

// The type lives in `@tuidom/core`, which declares no tokens, so the token sits in the lowest allowed layer.
// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it, the string inside is just a debug label
export const TuiApplicationDIToken = token<TuiApplication>("TuiApplication");
