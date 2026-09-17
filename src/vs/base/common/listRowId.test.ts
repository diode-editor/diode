import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { listRowId } from "./listRowId.ts";

describe("listRowId", () => {
    it("отдаёт id строки", () => {
        const row = new TextLabelElement("First");
        row.id = "row-1";
        expect(listRowId(row)).toBe("row-1");
    });

    it("элемент без id (в список такой не попадает) даёт пустую строку, а не падение", () => {
        expect(listRowId(new TextLabelElement("Без id"))).toBe("");
    });
});
