import { describe, expect, it } from "vitest";

import { Position, Range, Selection } from "./vscodeTypes.ts";

describe("VscodeTypes — Selection", () => {
    it("наследует Range с упорядоченными start/end", () => {
        const sel = new Selection(new Position(2, 4), new Position(1, 0));
        expect(sel).toBeInstanceOf(Range);
        expect(sel.start.isEqual(new Position(1, 0))).toBe(true);
        expect(sel.end.isEqual(new Position(2, 4))).toBe(true);
    });

    it("помнит anchor/active (направление сохраняется)", () => {
        const sel = new Selection(new Position(2, 4), new Position(1, 0));
        expect(sel.anchor.isEqual(new Position(2, 4))).toBe(true);
        expect(sel.active.isEqual(new Position(1, 0))).toBe(true);
        expect(sel.isReversed).toBe(true);
    });

    it("числовой конструктор (anchorLine, anchorChar, activeLine, activeChar)", () => {
        const sel = new Selection(0, 1, 0, 5);
        expect(sel.anchor.isEqual(new Position(0, 1))).toBe(true);
        expect(sel.active.isEqual(new Position(0, 5))).toBe(true);
        expect(sel.isReversed).toBe(false);
    });
});
