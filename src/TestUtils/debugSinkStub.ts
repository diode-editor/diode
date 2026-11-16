import type { IExtensionDebugSink } from "../vs/workbench/api/common/iExtensionDebugSink.ts";

/** The sessions' part of a debug sink, for tests about the rest: no events, no sessions, no breakpoints. */
export const SESSIONLESS_DEBUG_SINK: Pick<
    IExtensionDebugSink,
    | "subscribe"
    | "customRequest"
    | "getDebugProtocolBreakpoint"
    | "setSessionName"
    | "appendDebugConsole"
    | "registerBreakpoints"
    | "unregisterBreakpoints"
> = {
    subscribe: () => ({ dispose: () => undefined }),
    customRequest: () => Promise.reject(new Error("debug session not found")),
    getDebugProtocolBreakpoint: () => Promise.reject(new Error("debug session not found")),
    setSessionName: () => undefined,
    appendDebugConsole: () => undefined,
    registerBreakpoints: () => Promise.resolve(),
    unregisterBreakpoints: () => Promise.resolve(),
};
