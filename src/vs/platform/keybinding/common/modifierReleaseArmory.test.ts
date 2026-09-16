import { describe, expect, it, vi } from "vitest";

import { type CommandTrigger, holdModifierOf, ModifierReleaseArmory } from "./modifierReleaseArmory.ts";

function trigger(mods: Partial<CommandTrigger>): CommandTrigger {
    return { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}

describe("holdModifierOf", () => {
    it("maps Ctrl to Control", () => {
        expect(holdModifierOf(trigger({ ctrlKey: true }))).toBe("Control");
    });

    it("prefers Ctrl over Alt/Meta and ignores Shift", () => {
        expect(holdModifierOf(trigger({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe("Control");
    });

    it("falls back to Alt then Meta", () => {
        expect(holdModifierOf(trigger({ altKey: true }))).toBe("Alt");
        expect(holdModifierOf(trigger({ metaKey: true }))).toBe("Meta");
    });

    it("returns undefined when only Shift (or nothing) is held", () => {
        expect(holdModifierOf(trigger({ shiftKey: true }))).toBeUndefined();
        expect(holdModifierOf(trigger({}))).toBeUndefined();
    });
});

describe("ModifierReleaseArmory", () => {
    it("fires the armed commit when the matching modifier is released", () => {
        const armory = new ModifierReleaseArmory();
        const commit = vi.fn();

        armory.arm("Control", commit);
        armory.fireRelease("Control");

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("clears the pending commit after firing (release fires at most once)", () => {
        const armory = new ModifierReleaseArmory();
        const commit = vi.fn();

        armory.arm("Control", commit);
        armory.fireRelease("Control");
        armory.fireRelease("Control");

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("ignores the release of a different modifier, keeping the commit pending", () => {
        const armory = new ModifierReleaseArmory();
        const commit = vi.fn();

        armory.arm("Alt", commit);
        armory.fireRelease("Control");
        expect(commit).not.toHaveBeenCalled();

        armory.fireRelease("Alt");
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("a new arm overwrites the previous pending commit", () => {
        const armory = new ModifierReleaseArmory();
        const first = vi.fn();
        const second = vi.fn();

        armory.arm("Control", first);
        armory.arm("Alt", second);
        armory.fireRelease("Control"); // old modifier no longer pending
        expect(first).not.toHaveBeenCalled();

        armory.fireRelease("Alt");
        expect(second).toHaveBeenCalledTimes(1);
    });

    it("fireRelease is a no-op when nothing is armed", () => {
        const armory = new ModifierReleaseArmory();
        expect(() => {
            armory.fireRelease("Control");
        }).not.toThrow();
    });
});

describe("armOnHoldRelease within a trigger context", () => {
    it("arms on the current trigger's hold modifier", () => {
        const armory = new ModifierReleaseArmory();
        const commit = vi.fn();

        armory.withTrigger(trigger({ altKey: true }), () => {
            armory.armOnHoldRelease(commit);
        });
        armory.fireRelease("Alt");

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("does nothing when called outside any trigger context", () => {
        const armory = new ModifierReleaseArmory();
        const commit = vi.fn();

        armory.armOnHoldRelease(commit); // no withTrigger around it
        armory.fireRelease("Control");

        expect(commit).not.toHaveBeenCalled();
    });

    it("does nothing when the trigger has no hold modifier (Shift only)", () => {
        const armory = new ModifierReleaseArmory();
        const commit = vi.fn();

        armory.withTrigger(trigger({ shiftKey: true }), () => {
            armory.armOnHoldRelease(commit);
        });
        armory.fireRelease("Shift");

        expect(commit).not.toHaveBeenCalled();
    });

    it("restores the previous trigger context after nested runs", () => {
        const armory = new ModifierReleaseArmory();
        const outer = vi.fn();
        const inner = vi.fn();

        armory.withTrigger(trigger({ ctrlKey: true }), () => {
            armory.withTrigger(trigger({ altKey: true }), () => {
                armory.armOnHoldRelease(inner);
            });
            // Back in the outer (Ctrl) context after the nested run.
            armory.armOnHoldRelease(outer); // overwrites the inner arm
        });

        armory.fireRelease("Alt"); // inner was overwritten → nothing fires
        expect(inner).not.toHaveBeenCalled();

        armory.fireRelease("Control"); // outer context → fires
        expect(outer).toHaveBeenCalledTimes(1);
    });

    // Запасной путь к концу hold-сессии там, где keyup модификатора не приходит
    // (legacy-терминал): нажатие, которое сессию не продлило, её коммитит.
    describe("commitStaleAfter — коммит по нажатию, не продлившему сессию", () => {
        it("коммитит взвод, номер которого не изменился за время нажатия", () => {
            const armory = new ModifierReleaseArmory();
            const commit = vi.fn();
            armory.arm("Control", commit);

            const before = armory.pendingGeneration;
            armory.commitStaleAfter(before);

            expect(commit).toHaveBeenCalledTimes(1);
            // Взвод снят: последующее отпускание Ctrl второй раз не коммитит.
            armory.fireRelease("Control");
            expect(commit).toHaveBeenCalledTimes(1);
            expect(armory.pendingGeneration).toBeNull();
        });

        it("НЕ коммитит, если нажатие перевзвело сессию (следующий шаг того же цикла)", () => {
            const armory = new ModifierReleaseArmory();
            const first = vi.fn();
            const second = vi.fn();
            armory.arm("Control", first);

            const before = armory.pendingGeneration;
            armory.arm("Control", second); // шаг цикла перевзвёл сессию
            armory.commitStaleAfter(before);

            expect(first).not.toHaveBeenCalled();
            expect(second).not.toHaveBeenCalled();
            // Живая сессия: коммитится по отпусканию модификатора, как обычно.
            armory.fireRelease("Control");
            expect(second).toHaveBeenCalledTimes(1);
        });

        it("взвод, снятый отпусканием модификатора, повторно не коммитится", () => {
            const armory = new ModifierReleaseArmory();
            const commit = vi.fn();
            armory.arm("Control", commit);
            const before = armory.pendingGeneration;

            // Keyup успел прийти раньше, чем нажатие дошло до commitStaleAfter
            // (kitty шлёт и то, и другое): взвод уже снят, второй коммит не нужен.
            armory.fireRelease("Control");
            armory.commitStaleAfter(before);

            expect(commit).toHaveBeenCalledTimes(1);
        });

        it("без взвода на момент нажатия — no-op (в том числе когда взвод появился ВО время него)", () => {
            const armory = new ModifierReleaseArmory();
            const commit = vi.fn();

            const before = armory.pendingGeneration; // null — ничего не взведено
            armory.arm("Control", commit); // сессия началась этим самым нажатием
            armory.commitStaleAfter(before);

            expect(commit).not.toHaveBeenCalled();
            expect(armory.pendingGeneration).not.toBeNull();
        });
    });
});
