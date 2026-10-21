import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";

import { token } from "../../instantiation/common/diContainer.ts";

// The type lives in `@tuidom/core`, which declares no tokens, so the token is in platform.
// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference; the string is only a debug label
export const TerminalBackendDIToken = token<ITerminalBackend>("TerminalBackend");
