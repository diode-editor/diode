import { describe, expect, it } from "vitest";

import { MenuId } from "./menuId.ts";

describe("MenuId", () => {
    it("built-in menu points are class instances with a readable id", () => {
        expect(MenuId.EditorContext.id).toBe("EditorContext");
        expect(MenuId.MenubarMainMenu.id).toBe("MenubarMainMenu");
    });

    it("extensible: a new point is created via the constructor", () => {
        const custom = new MenuId("test.customMenu");
        expect(custom.id).toBe("test.customMenu");
        expect(custom).not.toBe(MenuId.EditorContext);
    });

    it("ids are unique: creating the same id again throws", () => {
        expect(() => new MenuId("EditorContext")).toThrow(/already exists/);
    });
});
