import { describe, expect, it } from "vitest";

import { ExtensionOwner } from "./vscodeHostContext.ts";

describe("ExtensionOwner — ambient owner", () => {
    it("there is no owner outside runAs", () => {
        expect(new ExtensionOwner().current).toBeUndefined();
    });

    it("runAs sets the owner for the call and returns the result", () => {
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

    it("nested runAs restores the outer owner", () => {
        const owner = new ExtensionOwner();
        const seen: (string | undefined)[] = [];
        owner.runAs("pub.outer", () => {
            owner.runAs("pub.inner", () => seen.push(owner.current));
            seen.push(owner.current);
        });
        expect(seen).toEqual(["pub.inner", "pub.outer"]);
        expect(owner.current).toBeUndefined();
    });

    it("an exception propagates, the owner is still restored", () => {
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
