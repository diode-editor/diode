import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { describe, expect, it, vi } from "vitest";

import { FocusTracker } from "./focusTracker.ts";

describe("FocusTracker", () => {
    it("hands the new active element to all subscribers until they unsubscribe", () => {
        const tracker = new FocusTracker();
        const first = vi.fn();
        const second = vi.fn();
        const subscription = tracker.onDidChangeFocus(first);
        tracker.onDidChangeFocus(second);
        const element = new FillerElement();

        tracker.fire(element);
        expect(first).toHaveBeenCalledWith(element);
        expect(second).toHaveBeenCalledWith(element);

        subscription.dispose();
        tracker.fire(null);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenLastCalledWith(null);
    });

    it("a subscriber that unsubscribes during dispatch does not break the walk over the rest", () => {
        const tracker = new FocusTracker();
        const late = vi.fn();
        const self = tracker.onDidChangeFocus(() => {
            self.dispose();
        });
        tracker.onDidChangeFocus(late);

        tracker.fire(null);
        expect(late).toHaveBeenCalledTimes(1);
    });

    it("dispose removes all subscriptions", () => {
        const tracker = new FocusTracker();
        const listener = vi.fn();
        tracker.onDidChangeFocus(listener);

        tracker.dispose();
        tracker.fire(null);
        expect(listener).not.toHaveBeenCalled();
    });
});
