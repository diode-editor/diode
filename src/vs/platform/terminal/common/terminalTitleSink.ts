import { token } from "../../instantiation/common/diContainer.ts";

/** Port: concrete backends have `setWindowTitle`, `ITerminalBackend` doesn't; the backend owner (`main.ts`) wires it. */
export type ITerminalTitleSink = (title: string) => void;

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference; the string is only a debug label
export const TerminalTitleSinkDIToken = token<ITerminalTitleSink>("TerminalTitleSink");
