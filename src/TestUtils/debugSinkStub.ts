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
    /* v8 ignore start -- test helper: what a test about the rest never asks */
    customRequest: () => Promise.reject(new Error("debug session not found")),
    getDebugProtocolBreakpoint: () => Promise.reject(new Error("debug session not found")),
    setSessionName: () => undefined,
    appendDebugConsole: () => undefined,
    registerBreakpoints: () => undefined,
    unregisterBreakpoints: () => undefined,
    /* v8 ignore stop */
};
