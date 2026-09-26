import { describe, expect, it } from "vitest";

import { currentCursorChangeSource, withCursorChangeSource } from "./cursorChangeSource.ts";

describe("cursorChangeSource", () => {
    it("вне области источник не объявлен", () => {
        expect(currentCursorChangeSource()).toBeUndefined();
    });

    it("внутри области виден объявленный источник, после — снова ничего", () => {
        const inside = withCursorChangeSource("mouse", () => currentCursorChangeSource());
        expect(inside).toBe("mouse");
        expect(currentCursorChangeSource()).toBeUndefined();
    });

    it("возвращает значение переданной функции", () => {
        expect(withCursorChangeSource("keyboard", () => 42)).toBe(42);
    });

    it("вложенная область не перебивает внешнюю: кейбинд, запустивший команду, остаётся keyboard", () => {
        const seen = withCursorChangeSource("keyboard", () =>
            withCursorChangeSource("command", () => currentCursorChangeSource()),
        );
        expect(seen).toBe("keyboard");
    });

    it("после выхода из вложенной области внешняя восстановлена", () => {
        const trail: (string | undefined)[] = [];
        withCursorChangeSource("mouse", () => {
            withCursorChangeSource("command", () => trail.push(currentCursorChangeSource()));
            trail.push(currentCursorChangeSource());
        });
        trail.push(currentCursorChangeSource());
        expect(trail).toEqual(["mouse", "mouse", undefined]);
    });

    it("исключение из функции не оставляет источник взведённым", () => {
        expect(() =>
            withCursorChangeSource("command", () => {
                throw new Error("boom");
            }),
        ).toThrow("boom");
        expect(currentCursorChangeSource()).toBeUndefined();
    });

    it("асинхронный хвост уже вне области — источник не протекает за await", async () => {
        let afterAwait: string | undefined = "unset";
        await withCursorChangeSource("command", async () => {
            await Promise.resolve();
            afterAwait = currentCursorChangeSource();
        });
        expect(afterAwait).toBeUndefined();
    });
});
