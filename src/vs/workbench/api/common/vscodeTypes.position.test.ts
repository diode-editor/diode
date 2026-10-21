import { describe, expect, it } from "vitest";

import { Position } from "./vscodeTypes.ts";

describe("VscodeTypes — Position", () => {
    it("хранит 0-based line/character и клампит отрицательные", () => {
        const p = new Position(2, 5);
        expect(p.line).toBe(2);
        expect(p.character).toBe(5);
        expect(new Position(-1, -3).line).toBe(0);
        expect(new Position(-1, -3).character).toBe(0);
    });

    it("isBefore/isAfter/isEqual сравнивают по строке, затем по символу", () => {
        const a = new Position(1, 2);
        const b = new Position(1, 5);
        const c = new Position(2, 0);
        expect(a.isBefore(b)).toBe(true);
        expect(b.isAfter(a)).toBe(true);
        expect(a.isBefore(c)).toBe(true);
        expect(a.isEqual(new Position(1, 2))).toBe(true);
        expect(a.isBeforeOrEqual(new Position(1, 2))).toBe(true);
        expect(a.isAfterOrEqual(new Position(1, 2))).toBe(true);
    });

    it("compareTo возвращает -1/0/1 по строке и символу", () => {
        const a = new Position(1, 2);
        expect(a.compareTo(new Position(2, 0))).toBe(-1);
        expect(a.compareTo(new Position(1, 5))).toBe(-1);
        expect(a.compareTo(new Position(1, 2))).toBe(0);
        expect(a.compareTo(new Position(1, 0))).toBe(1);
        expect(a.compareTo(new Position(0, 9))).toBe(1);
    });

    it("translate — оба перегруза + дефолты, иммутабельность", () => {
        const p = new Position(1, 1);
        expect(p.translate(2, 3).isEqual(new Position(3, 4))).toBe(true);
        expect(p.translate({ characterDelta: 4 }).isEqual(new Position(1, 5))).toBe(true);
        expect(p.translate({ lineDelta: 2 }).isEqual(new Position(3, 1))).toBe(true);
        expect(p.translate()).toBe(p);
        expect(p.line).toBe(1);
    });

    it("with — оба перегруза + дефолты", () => {
        const p = new Position(1, 1);
        expect(p.with(4).isEqual(new Position(4, 1))).toBe(true);
        expect(p.with(undefined, 9).isEqual(new Position(1, 9))).toBe(true);
        expect(p.with({ character: 7 }).isEqual(new Position(1, 7))).toBe(true);
        expect(p.with({ line: 5 }).isEqual(new Position(5, 1))).toBe(true);
        expect(p.with(1, 1)).toBe(p);
    });
});
