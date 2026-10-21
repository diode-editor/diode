import type { IDisposable } from "../../../base/common/lifecycle.ts";

/**
 * Contract: delivery is asynchronous, no earlier than the next tick; after `dispose()`
 * `postMessage` is silently ignored and listeners are not called; data must be
 * JSON-compatible only (the sides may live in different processes).
 */
export interface IMessageChannel extends IDisposable {
    postMessage(message: unknown): void;
    onMessage(listener: (message: unknown) => void): IDisposable;
}
