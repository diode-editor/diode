import { describe, expect, it } from "vitest";

import type { MenuEntry } from "./popupMenuElement.ts";
import { PopupMenuElement } from "./popupMenuElement.ts";

describe("PopupMenuElement.inspectState", () => {
    it("reports item labels (separators as null) and the selected index", () => {
        const entries: MenuEntry[] = [{ label: "Cut" }, { label: "Copy" }, { type: "separator" }, { label: "Paste" }];
        const menu = new PopupMenuElement(entries);

        // Первый выбираемый пункт активен по умолчанию.
        expect(menu.inspectState()).toEqual({
            selectedIndex: 0,
            items: ["Cut", "Copy", null, "Paste"],
        });
    });
});
