import { describe, expect, it } from "vitest";

import { ExtensionOwner } from "./vscodeHostContext.ts";

describe("ExtensionOwner — окружающий владелец", () => {
    it("вне runAs владельца нет", () => {
        expect(new ExtensionOwner().current).toBeUndefined();
    });

    it("runAs выставляет владельца на время вызова и возвращает результат", () => {
        const owner = new ExtensionOwner();
        const seen: (string | undefined)[] = [];
        const result = owner.runAs("pub.a", () => {
            seen.push(owner.current);
            return 42;
        });
        expect(result).toBe(42);
        expect(seen).toEqual(["pub.a"]);
        expect(owner.current).toBeUndefined();
    });

    it("вложенный runAs восстанавливает внешнего владельца", () => {
        const owner = new ExtensionOwner();
        const seen: (string | undefined)[] = [];
        owner.runAs("pub.outer", () => {
            owner.runAs("pub.inner", () => seen.push(owner.current));
            seen.push(owner.current);
        });
        expect(seen).toEqual(["pub.inner", "pub.outer"]);
        expect(owner.current).toBeUndefined();
    });

    it("исключение пролетает насквозь, владелец всё равно восстановлен", () => {
        const owner = new ExtensionOwner();
        owner.runAs("pub.outer", () => {
            expect(() =>
                owner.runAs("pub.inner", () => {
                    throw new Error("boom");
                }),
            ).toThrow("boom");
            expect(owner.current).toBe("pub.outer");
        });
        expect(owner.current).toBeUndefined();
    });
});
