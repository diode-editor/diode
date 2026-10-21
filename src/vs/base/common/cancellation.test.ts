import { describe, expect, it, vi } from "vitest";

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../TestUtils/disposableLeaks.ts";

import type { ICancellationListener, ICancellationToken } from "./cancellation.ts";
import { CancellationTokenNone, CancellationTokenSource, LatestRequest } from "./cancellation.ts";

ensureNoDisposablesAreLeakedInTestSuite();

/** Spy parent: shows whether anyone is subscribed to it right now. */
function spyParent(): { token: ICancellationToken; fire: () => void; readonly subscribers: number } {
    const listeners = new Set<ICancellationListener>();
    return {
        token: {
            isCancellationRequested: false,
            onCancellationRequested: (listener) => {
                listeners.add(listener);
                return { dispose: () => listeners.delete(listener) };
            },
        },
        fire: () => {
            for (const listener of [...listeners]) listener();
        },
        get subscribers() {
            return listeners.size;
        },
    };
}

describe("CancellationTokenSource", () => {
    it("cancel sets the flag and calls subscribers exactly once", () => {
        const source = new CancellationTokenSource();
        const first = vi.fn();
        const second = vi.fn();
        source.token.onCancellationRequested(first);
        source.token.onCancellationRequested(second);

        expect(source.token.isCancellationRequested).toBe(false);
        expect(first).not.toHaveBeenCalled();

        source.cancel();
        expect(source.token.isCancellationRequested).toBe(true);
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();

        source.cancel();
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });

    it("subscribing to an ALREADY cancelled token calls the listener immediately", () => {
        const source = new CancellationTokenSource();
        source.cancel();

        const late = vi.fn();
        const subscription = source.token.onCancellationRequested(late);
        expect(late).toHaveBeenCalledOnce();

        subscription.dispose();
        source.cancel();
        expect(late).toHaveBeenCalledOnce();
    });

    it("disposing a subscription removes its listener, disposing the source removes all", () => {
        const source = new CancellationTokenSource();
        const dropped = vi.fn();
        const kept = vi.fn();
        const subscription = source.token.onCancellationRequested(dropped);
        source.token.onCancellationRequested(kept);

        subscription.dispose();
        // A second dispose doesn't remove someone else's listener.
        subscription.dispose();
        source.cancel();

        expect(dropped).not.toHaveBeenCalled();
        expect(kept).toHaveBeenCalledOnce();

        const other = new CancellationTokenSource();
        const listener = vi.fn();
        other.token.onCancellationRequested(listener);
        other.dispose();
        other.cancel();
        expect(listener).not.toHaveBeenCalled();
        expect(other.token.isCancellationRequested).toBe(true);
    });

    it("a listener may unsubscribe a sibling from its callback — iteration runs over a snapshot", () => {
        const source = new CancellationTokenSource();
        const neighbour = vi.fn();
        let neighbourSubscription = { dispose: (): void => undefined };
        source.token.onCancellationRequested(() => {
            neighbourSubscription.dispose();
        });
        neighbourSubscription = source.token.onCancellationRequested(neighbour);

        source.cancel();

        expect(neighbour).toHaveBeenCalledOnce();
    });
});

describe("CancellationTokenSource(parent)", () => {
    it("cancelling the parent cancels the source and calls its listeners", () => {
        const parent = new CancellationTokenSource();
        const child = new CancellationTokenSource(parent.token);
        const listener = vi.fn();
        child.token.onCancellationRequested(listener);

        parent.cancel();

        expect(child.token.isCancellationRequested).toBe(true);
        expect(listener).toHaveBeenCalledOnce();
    });

    it("an already cancelled parent cancels the source immediately", () => {
        const parent = new CancellationTokenSource();
        parent.cancel();

        expect(new CancellationTokenSource(parent.token).token.isCancellationRequested).toBe(true);
    });

    it("cancelling the source leaves the parent alone", () => {
        const parent = new CancellationTokenSource();
        const child = new CancellationTokenSource(parent.token);

        child.cancel();

        expect(parent.token.isCancellationRequested).toBe(false);
    });

    it("dispose removes the subscription to the parent", () => {
        const parent = spyParent();
        const child = new CancellationTokenSource(parent.token);
        expect(parent.subscribers).toBe(1);

        child.dispose();

        expect(parent.subscribers).toBe(0);
        parent.fire();
        expect(child.token.isCancellationRequested).toBe(false);
    });
});

describe("LatestRequest", () => {
    it("start supersedes the previous ticket: the old one goes stale, the new one does not", () => {
        const latest = new LatestRequest();
        const first = latest.start();
        expect(first.isStale()).toBe(false);
        expect(first.token.isCancellationRequested).toBe(false);

        const second = latest.start();

        expect(first.isStale()).toBe(true);
        expect(first.token.isCancellationRequested).toBe(true);
        expect(second.isStale()).toBe(false);
    });

    it("cancel makes the current ticket stale, the next start is fresh again", () => {
        const latest = new LatestRequest();
        const ticket = latest.start();

        latest.cancel();
        expect(ticket.isStale()).toBe(true);
        latest.cancel();

        expect(latest.start().isStale()).toBe(false);
    });

    it("pending: set from start until done or cancellation", () => {
        const latest = new LatestRequest();
        expect(latest.pending).toBe(false);

        const ticket = latest.start();
        expect(latest.pending).toBe(true);
        ticket.done();
        expect(latest.pending).toBe(false);
        // Owner cancellation doesn't touch a completed ticket.
        latest.cancel();
        expect(ticket.isStale()).toBe(false);

        latest.start();
        latest.cancel();
        expect(latest.pending).toBe(false);
    });

    it("done of a superseded ticket does not clear pending of the new one", () => {
        const latest = new LatestRequest();
        const first = latest.start();
        const second = latest.start();

        first.done();

        expect(latest.pending).toBe(true);
        latest.cancel();
        expect(second.isStale()).toBe(true);
    });

    it("cancelling the parent makes the ticket stale", () => {
        const latest = new LatestRequest();
        const parent = new CancellationTokenSource();
        const ticket = latest.start(parent.token);

        parent.cancel();

        expect(ticket.isStale()).toBe(true);
    });

    it("both done and a superseding start remove the subscription to the parent", () => {
        const latest = new LatestRequest();
        const parent = spyParent();

        latest.start(parent.token).done();
        expect(parent.subscribers).toBe(0);

        latest.start(parent.token);
        expect(parent.subscribers).toBe(1);
        latest.start();
        expect(parent.subscribers).toBe(0);
    });

    it("after dispose the current ticket is stale and new ones are issued already cancelled", () => {
        const latest = new LatestRequest();
        const ticket = latest.start();

        latest.dispose();

        expect(ticket.isStale()).toBe(true);
        const late = latest.start();
        expect(late.isStale()).toBe(true);
        expect(late.token.isCancellationRequested).toBe(true);
    });
});

describe("CancellationTokenNone", () => {
    it("is never cancelled and returns a no-op subscription", () => {
        const listener = vi.fn();
        const subscription = CancellationTokenNone.onCancellationRequested(listener);

        expect(CancellationTokenNone.isCancellationRequested).toBe(false);
        expect(listener).not.toHaveBeenCalled();
        expect(() => {
            subscription.dispose();
        }).not.toThrow();
    });
});
