import type { IDisposable } from "../../../base/common/lifecycle.ts";

/**
 * Contract: delivery is asynchronous, no earlier than the next tick; after `dispose()`
 * `postMessage` is silently ignored and listeners are not called; data crosses a structured
 * clone (the sides may live in different processes): plain data, `Map`/`Set`/`Date`/typed arrays
 * and `undefined` fields survive, prototypes and `toJSON()` do not. A payload the clone rejects
 * (a function, a symbol, a proxy) arrives as its JSON image instead — logged, never dropped silently.
 */
export interface IMessageChannel extends IDisposable {
    postMessage(message: unknown): void;
    onMessage(listener: (message: unknown) => void): IDisposable;
}
