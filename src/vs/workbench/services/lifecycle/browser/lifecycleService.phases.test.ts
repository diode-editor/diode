import { describe, expect, it } from "vitest";

import { DialogService } from "../../dialogs/browser/dialogService.ts";

import { LifecycleService } from "./lifecycleService.ts";

function createLifecycle(): LifecycleService {
    return new LifecycleService(new DialogService());
}

describe("LifecycleService: startup phases", () => {
    it("starts in starting", () => {
        expect(createLifecycle().phase).toBe("starting");
    });

    it("a jump over several phases passes through the intermediate ones in order", () => {
        const lifecycle = createLifecycle();
        const seen: string[] = [];
        lifecycle.onDidChangePhase((phase) => {
            // The listener already sees the new phase: the transition happens before notification.
            seen.push(`${phase}/${lifecycle.phase}`);
        });

        lifecycle.setPhase("restored");

        expect(seen).toEqual(["ready/ready", "restored/restored"]);
        expect(lifecycle.phase).toBe("restored");
    });

    it("repeating the current phase is a no-op", () => {
        const lifecycle = createLifecycle();
        lifecycle.setPhase("ready");
        const seen: string[] = [];
        lifecycle.onDidChangePhase((phase) => seen.push(phase));

        lifecycle.setPhase("ready");

        expect(seen).toEqual([]);
    });

    it("going backward is an error in the startup order", () => {
        const lifecycle = createLifecycle();
        lifecycle.setPhase("restored");

        expect(() => {
            lifecycle.setPhase("ready");
        }).toThrow("Lifecycle cannot go backwards: restored → ready");
        expect(lifecycle.phase).toBe("restored");
    });

    it("a removed listener does not hear transitions", () => {
        const lifecycle = createLifecycle();
        const seen: string[] = [];
        lifecycle.onDidChangePhase((phase) => seen.push(phase)).dispose();

        lifecycle.setPhase("eventually");

        expect(seen).toEqual([]);
    });

    it("when waits for a phase and resolves at the moment of the transition into it", async () => {
        const lifecycle = createLifecycle();
        const resolved: string[] = [];
        void lifecycle.when("restored").then(() => resolved.push("restored"));
        void lifecycle.when("eventually").then(() => resolved.push("eventually"));

        lifecycle.setPhase("ready");
        await Promise.resolve();
        expect(resolved).toEqual([]);

        lifecycle.setPhase("restored");
        await Promise.resolve();
        expect(resolved).toEqual(["restored"]);

        lifecycle.setPhase("eventually");
        await Promise.resolve();
        expect(resolved).toEqual(["restored", "eventually"]);
    });

    it("when on a reached (or passed) phase resolves immediately", async () => {
        const lifecycle = createLifecycle();
        lifecycle.setPhase("restored");
        const resolved: string[] = [];

        await Promise.all([
            lifecycle.when("ready").then(() => resolved.push("ready")),
            lifecycle.when("restored").then(() => resolved.push("restored")),
        ]);

        expect(resolved).toEqual(["ready", "restored"]);
    });

    it("when(starting) resolves immediately: this phase begins with the service's birth", async () => {
        await expect(createLifecycle().when("starting")).resolves.toBeUndefined();
    });

    it("several waiters on one phase all resolve", async () => {
        const lifecycle = createLifecycle();
        const waits = [lifecycle.when("ready"), lifecycle.when("ready")];

        lifecycle.setPhase("ready");

        await expect(Promise.all(waits)).resolves.toEqual([undefined, undefined]);
    });
});
