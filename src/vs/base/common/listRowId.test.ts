import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { describe, expect, it } from "vitest";

import { listRowId } from "./listRowId.ts";

describe("listRowId", () => {
    it("returns the row id", () => {
        const row = new TextLabelElement("First");
        row.id = "row-1";
        expect(listRowId(row)).toBe("row-1");
    });

    it("an element without an id (never put in a list) gives an empty string, not a crash", () => {
        expect(listRowId(new TextLabelElement("No id"))).toBe("");
    });
});
