import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../TestUtils/disposableLeaks.ts";

import { setUnexpectedErrorHandler } from "./errors.ts";
import { Emitter, Event } from "./event.ts";
import { Disposable } from "./lifecycle.ts";

const disposables = ensureNoDisposablesAreLeakedInTestSuite();

describe("Emitter", () => {
    it("delivers the event to all listeners in subscription order", () => {
        const emitter = new Emitter<number>();
        const log: string[] = [];
        disposables.add(emitter.event((e) => log.push(`a${String(e)}`)));
        disposables.add(emitter.event((e) => log.push(`b${String(e)}`)));
        emitter.fire(1);
        emitter.fire(2);
        expect(log).toEqual(["a1", "b1", "a2", "b2"]);
    });

    it("unsubscribing removes the listener; a repeated unsubscribe is a no-op", () => {
        const emitter = new Emitter<number>();
        const a = vi.fn();
        const b = vi.fn();
        const subA = emitter.event(a);
        disposables.add(emitter.event(b));
        subA.dispose();
        subA.dispose();
        emitter.fire(1);
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledOnce();
    });

    it("the same handler twice gives two independent subscriptions", () => {
        const emitter = new Emitter<number>();
        const fn = vi.fn();
        const first = emitter.event(fn);
        disposables.add(emitter.event(fn));
        emitter.fire(1);
        expect(fn).toHaveBeenCalledTimes(2);
        first.dispose();
        emitter.fire(2);
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it("G1: a listener added during fire is not called in that fire", () => {
        const emitter = new Emitter<number>();
        const late = vi.fn();
        disposables.add(
            emitter.event(() => {
                disposables.add(emitter.event(late));
            }),
        );
        emitter.fire(1);
        expect(late).not.toHaveBeenCalled();
        emitter.fire(2);
        expect(late).toHaveBeenCalledWith(2);
    });

    it("G2: a listener removed during fire before being reached is not called, the next one is", () => {
        const emitter = new Emitter<number>();
        const second = vi.fn();
        const third = vi.fn();
        disposables.add(
            emitter.event(() => {
                secondSub.dispose();
            }),
        );
        const secondSub = emitter.event(second);
        disposables.add(emitter.event(third));
        emitter.fire(1);
        expect(second).not.toHaveBeenCalled();
        expect(third).toHaveBeenCalledOnce();
    });

    it("a listener may remove itself during fire", () => {
        const emitter = new Emitter<number>();
        const after = vi.fn();
        const self = emitter.event(() => {
            self.dispose();
        });
        disposables.add(emitter.event(after));
        emitter.fire(1);
        emitter.fire(2);
        expect(after).toHaveBeenCalledTimes(2);
        expect(emitter.hasListeners()).toBe(true);
    });

    describe("G3: listener errors", () => {
        afterEach(() => {
            setUnexpectedErrorHandler((e) => {
                console.error(e);
            });
        });

        it("go to onUnexpectedError by default, the other listeners still get the event", () => {
            const handler = vi.fn();
            setUnexpectedErrorHandler(handler);
            const emitter = new Emitter<number>();
            const boom = new Error("boom");
            const after = vi.fn();
            disposables.add(
                emitter.event(() => {
                    throw boom;
                }),
            );
            disposables.add(emitter.event(after));
            expect(() => {
                emitter.fire(1);
            }).not.toThrow();
            expect(handler).toHaveBeenCalledExactlyOnceWith(boom);
            expect(after).toHaveBeenCalledWith(1);
        });

        it("onListenerError intercepts instead of onUnexpectedError", () => {
            const handler = vi.fn();
            setUnexpectedErrorHandler(handler);
            const onListenerError = vi.fn();
            const emitter = new Emitter<number>({ onListenerError });
            const boom = new Error("boom");
            disposables.add(
                emitter.event(() => {
                    throw boom;
                }),
            );
            emitter.fire(1);
            expect(onListenerError).toHaveBeenCalledExactlyOnceWith(boom);
            expect(handler).not.toHaveBeenCalled();
        });
    });

    it("hasListeners reflects the subscription count", () => {
        const emitter = new Emitter<number>();
        expect(emitter.hasListeners()).toBe(false);
        const sub = emitter.event(() => undefined);
        expect(emitter.hasListeners()).toBe(true);
        sub.dispose();
        expect(emitter.hasListeners()).toBe(false);
    });

    it("G6: first and last listener hooks", () => {
        const log: string[] = [];
        const emitter = new Emitter<number>({
            onWillAddFirstListener: () => log.push(`first(${String(emitter.hasListeners())})`),
            onDidRemoveLastListener: () => log.push(`last(${String(emitter.hasListeners())})`),
        });
        const a = emitter.event(() => undefined);
        const b = emitter.event(() => undefined);
        a.dispose();
        expect(log).toEqual(["first(false)"]);
        b.dispose();
        expect(log).toEqual(["first(false)", "last(false)"]);

        const c = emitter.event(() => undefined);
        expect(log).toEqual(["first(false)", "last(false)", "first(false)"]);
        c.dispose();
    });

    describe("G5: dispose", () => {
        it("removes listeners, calls the last-listener hook once; later fire is a no-op", () => {
            const onDidRemoveLastListener = vi.fn();
            const emitter = new Emitter<number>({ onDidRemoveLastListener });
            const fn = vi.fn();
            const sub = emitter.event(fn);
            emitter.dispose();
            expect(emitter.hasListeners()).toBe(false);
            expect(onDidRemoveLastListener).toHaveBeenCalledOnce();
            emitter.fire(1);
            expect(fn).not.toHaveBeenCalled();

            // A late unsubscribe from a dead emitter doesn't fire the hook a second time.
            sub.dispose();
            emitter.dispose();
            expect(onDidRemoveLastListener).toHaveBeenCalledOnce();
        });

        it("without listeners the last-listener hook is not called", () => {
            const onDidRemoveLastListener = vi.fn();
            new Emitter<number>({ onDidRemoveLastListener }).dispose();
            expect(onDidRemoveLastListener).not.toHaveBeenCalled();
        });

        it("subscribing to a disposed emitter is a no-op, the first-listener hook is not called", () => {
            const onWillAddFirstListener = vi.fn();
            const emitter = new Emitter<number>({ onWillAddFirstListener });
            emitter.dispose();
            expect(emitter.event(() => undefined)).toBe(Disposable.None);
            expect(emitter.hasListeners()).toBe(false);
            expect(onWillAddFirstListener).not.toHaveBeenCalled();
        });

        it("dispose in the middle of fire: listeners not yet reached are not called", () => {
            const emitter = new Emitter<number>();
            const second = vi.fn();
            const first = emitter.event(() => {
                emitter.dispose();
            });
            const secondSub = emitter.event(second);
            emitter.fire(1);
            expect(second).not.toHaveBeenCalled();
            first.dispose();
            secondSub.dispose();
        });
    });
});

describe("Event.None", () => {
    it("subscribing returns a no-op and never calls the listener", () => {
        const fn = vi.fn();
        expect(Event.None(fn)).toBe(Disposable.None);
        expect(fn).not.toHaveBeenCalled();
    });
});

describe("Event.once", () => {
    it("delivers the first event and unsubscribes", () => {
        const emitter = new Emitter<number>();
        const fn = vi.fn();
        Event.once(emitter.event)(fn);
        emitter.fire(1);
        emitter.fire(2);
        expect(fn).toHaveBeenCalledExactlyOnceWith(1);
        expect(emitter.hasListeners()).toBe(false);
    });

    it("unsubscribing before the event — the listener is not called", () => {
        const emitter = new Emitter<number>();
        const fn = vi.fn();
        Event.once(emitter.event)(fn).dispose();
        emitter.fire(1);
        expect(fn).not.toHaveBeenCalled();
        expect(emitter.hasListeners()).toBe(false);
    });

    it("an event fired synchronously during subscription is delivered once and the subscription is removed", () => {
        const fn = vi.fn();
        let fireNow: ((e: number) => unknown) | undefined;
        const unsubscribe = vi.fn();
        const eager: Event<number> = (listener) => {
            fireNow = listener;
            listener(7);
            listener(8);
            return { dispose: unsubscribe };
        };
        Event.once(eager)(fn);
        expect(fn).toHaveBeenCalledExactlyOnceWith(7);
        expect(unsubscribe).toHaveBeenCalledOnce();
        fireNow?.(9);
        expect(fn).toHaveBeenCalledOnce();
    });
});
