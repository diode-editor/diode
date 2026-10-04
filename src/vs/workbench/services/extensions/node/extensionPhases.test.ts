import { describe, expect, it } from "vitest";

import { ExtensionPhases } from "./extensionPhases.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

function reg(id: string): IExtensionRegistration {
    return { id, source: "", manifest: {} } as unknown as IExtensionRegistration;
}

describe("ExtensionPhases", () => {
    it("регистрация: в каталог и в ожидание, id занят", () => {
        const phases = new ExtensionPhases();
        const a = reg("a");
        const b = reg("b");
        expect(phases.isRegistered("a")).toBe(false);

        phases.register(a);
        phases.register(b);

        expect(phases.isRegistered("a")).toBe(true);
        expect([...phases.all()]).toEqual([a, b]);
        expect(phases.pendingRegistrations()).toEqual([a, b]);
        expect(phases.isActive("a")).toBe(false);
        expect(phases.activeCount).toBe(0);
    });

    it("активация: забрать из ожидания один раз, затем активно", () => {
        const phases = new ExtensionPhases();
        const a = reg("a");
        phases.register(a);

        expect(phases.takePending("a")).toBe(true);
        expect(phases.takePending("a")).toBe(false);
        // Поднимается: ни в одной фазе, но в каталоге.
        expect(phases.isRegistered("a")).toBe(false);
        expect([...phases.all()]).toEqual([a]);

        phases.markActive(a);
        expect(phases.isActive("a")).toBe(true);
        expect(phases.isRegistered("a")).toBe(true);
        expect(phases.activeCount).toBe(1);
        expect(phases.pendingRegistrations()).toEqual([]);
    });

    it("оборванная активация возвращается, только если регистрация та же", () => {
        const phases = new ExtensionPhases();
        const a = reg("a");
        phases.register(a);
        phases.takePending("a");

        expect(phases.returnInterrupted(a)).toBe(true);
        expect(phases.pendingRegistrations()).toEqual([a]);

        // Сняли и зарегистрировали заново другой записью — старая не возвращается.
        phases.takePending("a");
        phases.forget("a");
        expect(phases.returnInterrupted(a)).toBe(false);
        const again = reg("a");
        phases.register(again);
        phases.takePending("a");
        expect(phases.returnInterrupted(a)).toBe(false);
        expect(phases.pendingRegistrations()).toEqual([]);
    });

    it("снятие: каталог, ожидание и активные — каждое отвечает, было ли что снимать", () => {
        const phases = new ExtensionPhases();
        const a = reg("a");
        const b = reg("b");
        phases.register(a);
        phases.register(b);
        phases.takePending("b");
        phases.markActive(b);

        expect(phases.dropPending("a")).toBe(true);
        expect(phases.dropPending("a")).toBe(false);
        expect(phases.deactivate("b")).toBe(true);
        expect(phases.deactivate("b")).toBe(false);
        expect(phases.forget("a")).toBe(true);
        expect(phases.forget("a")).toBe(false);
        expect([...phases.all()]).toEqual([b]);
        expect(phases.activeCount).toBe(0);
    });

    it("оживление: все активные — обратно в ожидание", () => {
        const phases = new ExtensionPhases();
        const a = reg("a");
        const b = reg("b");
        const c = reg("c");
        for (const r of [a, b, c]) phases.register(r);
        for (const r of [a, b]) {
            phases.takePending(r.id);
            phases.markActive(r);
        }

        expect(phases.reviveAll()).toEqual([a, b]);
        expect(phases.activeCount).toBe(0);
        expect(phases.isActive("a")).toBe(false);
        expect(phases.pendingRegistrations()).toEqual([c, a, b]);
        expect(phases.reviveAll()).toEqual([]);
    });

    it("снимок ожидания не меняется от последующих переходов", () => {
        const phases = new ExtensionPhases();
        phases.register(reg("a"));
        const snapshot = phases.pendingRegistrations();
        phases.takePending("a");
        expect(snapshot).toHaveLength(1);
    });

    it("выключение очищает всё", () => {
        const phases = new ExtensionPhases();
        const a = reg("a");
        const b = reg("b");
        phases.register(a);
        phases.register(b);
        phases.takePending("b");
        phases.markActive(b);

        phases.clear();

        expect([...phases.all()]).toEqual([]);
        expect(phases.pendingRegistrations()).toEqual([]);
        expect(phases.activeCount).toBe(0);
        expect(phases.isRegistered("a")).toBe(false);
        expect(phases.isRegistered("b")).toBe(false);
    });
});
