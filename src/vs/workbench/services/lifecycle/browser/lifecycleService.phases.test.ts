import { describe, expect, it } from "vitest";

import { DialogService } from "../../dialogs/browser/dialogService.ts";

import { LifecycleService } from "./lifecycleService.ts";

function createLifecycle(): LifecycleService {
    return new LifecycleService(new DialogService());
}

describe("LifecycleService — фазы старта", () => {
    it("стартует в starting", () => {
        expect(createLifecycle().phase).toBe("starting");
    });

    it("переход через несколько фаз проходит промежуточные по порядку", () => {
        const lifecycle = createLifecycle();
        const seen: string[] = [];
        lifecycle.onDidChangePhase((phase) => {
            // Слушатель видит уже новую фазу: переход совершился до оповещения.
            seen.push(`${phase}/${lifecycle.phase}`);
        });

        lifecycle.setPhase("restored");

        expect(seen).toEqual(["ready/ready", "restored/restored"]);
        expect(lifecycle.phase).toBe("restored");
    });

    it("повтор текущей фазы — no-op", () => {
        const lifecycle = createLifecycle();
        lifecycle.setPhase("ready");
        const seen: string[] = [];
        lifecycle.onDidChangePhase((phase) => seen.push(phase));

        lifecycle.setPhase("ready");

        expect(seen).toEqual([]);
    });

    it("откат назад — ошибка в порядке старта", () => {
        const lifecycle = createLifecycle();
        lifecycle.setPhase("restored");

        expect(() => {
            lifecycle.setPhase("ready");
        }).toThrow("Lifecycle cannot go backwards: restored → ready");
        expect(lifecycle.phase).toBe("restored");
    });

    it("снятый слушатель переходов не слышит", () => {
        const lifecycle = createLifecycle();
        const seen: string[] = [];
        lifecycle.onDidChangePhase((phase) => seen.push(phase)).dispose();

        lifecycle.setPhase("eventually");

        expect(seen).toEqual([]);
    });

    it("when ждёт фазу и резолвится в момент перехода в неё", async () => {
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

    it("when по достигнутой (или пройденной) фазе резолвится сразу", async () => {
        const lifecycle = createLifecycle();
        lifecycle.setPhase("restored");
        const resolved: string[] = [];

        await Promise.all([
            lifecycle.when("ready").then(() => resolved.push("ready")),
            lifecycle.when("restored").then(() => resolved.push("restored")),
        ]);

        expect(resolved).toEqual(["ready", "restored"]);
    });

    it("when(starting) резолвится сразу — эта фаза наступила с рождением сервиса", async () => {
        await expect(createLifecycle().when("starting")).resolves.toBeUndefined();
    });

    it("несколько ожидающих одной фазы резолвятся все", async () => {
        const lifecycle = createLifecycle();
        const waits = [lifecycle.when("ready"), lifecycle.when("ready")];

        lifecycle.setPhase("ready");

        await expect(Promise.all(waits)).resolves.toEqual([undefined, undefined]);
    });
});
