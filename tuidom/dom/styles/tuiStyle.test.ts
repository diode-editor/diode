import { describe, expect, it } from "vitest";

import { DEFAULT_COLOR, packRgb } from "../../common/colorUtils.ts";

import { ROOT_VAR_SCOPE, STYLE_TOKEN_DEFAULTS } from "./styleTokens.ts";
import type { ResolvedTUIStyle, StyleStateSelector } from "./tuiStyle.ts";
import {
    extendVarScope,
    INHERITED_BG,
    INHERITED_FG,
    mergeStyleVariants,
    resolveStyle,
    resolveStyleColor,
    ROOT_RESOLVED_STYLE,
    styleEquals,
} from "./tuiStyle.ts";

describe("resolveStyleColor", () => {
    const ifg = packRgb(200, 200, 200);
    const ibg = packRgb(30, 30, 30);

    it("resolves INHERITED_FG to inherited fg", () => {
        expect(resolveStyleColor(INHERITED_FG, ifg, ibg)).toBe(ifg);
    });

    it("resolves INHERITED_BG to inherited bg", () => {
        expect(resolveStyleColor(INHERITED_BG, ifg, ibg)).toBe(ibg);
    });

    it("passes through concrete RGB unchanged", () => {
        const red = packRgb(255, 0, 0);
        expect(resolveStyleColor(red, ifg, ibg)).toBe(red);
    });

    it("passes through DEFAULT_COLOR unchanged", () => {
        expect(resolveStyleColor(DEFAULT_COLOR, ifg, ibg)).toBe(DEFAULT_COLOR);
    });

    it("токен резолвится из переданного scope", () => {
        const scope = { "my.token": packRgb(9, 8, 7) };
        expect(resolveStyleColor("my.token", ifg, ibg, scope)).toBe(packRgb(9, 8, 7));
    });

    it("токен без scope резолвится из дефолтов tuidom", () => {
        expect(resolveStyleColor("list.activeSelectionBackground", ifg, ibg)).toBe(
            STYLE_TOKEN_DEFAULTS["list.activeSelectionBackground"],
        );
    });

    it("незнакомый токен — fail-fast с владельцем и именем токена", () => {
        expect(() => resolveStyleColor("no.such.token", ifg, ibg, undefined, () => "ButtonElement#ok")).toThrow(
            'ButtonElement#ok: неизвестный цветовой токен "no.such.token"',
        );
        expect(() => resolveStyleColor("no.such.token", ifg, ibg)).toThrow("TUIStyle");
    });

    it("ключи Object.prototype не считаются токенами", () => {
        expect(() => resolveStyleColor("toString", ifg, ibg, {})).toThrow('неизвестный цветовой токен "toString"');
    });

    it("extendVarScope: свои значения поверх родительских, лукап по цепочке", () => {
        const parent = { a: 1, b: 2 };
        const scope = extendVarScope(parent, { b: 20, c: 30 });
        expect(resolveStyleColor("a", ifg, ibg, scope)).toBe(1);
        expect(resolveStyleColor("b", ifg, ibg, scope)).toBe(20);
        expect(resolveStyleColor("c", ifg, ibg, scope)).toBe(30);
    });
});

describe("ROOT_VAR_SCOPE", () => {
    it("заморожен, с null-прототипом, несёт дефолты", () => {
        expect(Object.isFrozen(ROOT_VAR_SCOPE)).toBe(true);
        expect(Object.getPrototypeOf(ROOT_VAR_SCOPE)).toBeNull();
        expect(ROOT_VAR_SCOPE["list.activeSelectionForeground"]).toBe(
            STYLE_TOKEN_DEFAULTS["list.activeSelectionForeground"],
        );
    });
});

describe("styleEquals", () => {
    it("рефлексивно и по идентичности", () => {
        const s = { fg: packRgb(1, 2, 3) };
        expect(styleEquals(s, s)).toBe(true);
    });

    it("равные значения в разных объектах равны", () => {
        expect(styleEquals({ fg: 5, bg: 7 }, { fg: 5, bg: 7 })).toBe(true);
        expect(styleEquals({}, {})).toBe(true);
    });

    it("различие в fg или bg — не равны", () => {
        expect(styleEquals({ fg: 5 }, { fg: 6 })).toBe(false);
        expect(styleEquals({ bg: 5 }, { bg: 6 })).toBe(false);
        expect(styleEquals({ fg: 5 }, {})).toBe(false);
        expect(styleEquals({}, { bg: 7 })).toBe(false);
    });

    it("undefined и DEFAULT_COLOR различимы", () => {
        expect(styleEquals({ fg: DEFAULT_COLOR }, {})).toBe(false);
    });

    it("when: равные по значению массивы равны, различия ловятся", () => {
        const a = { fg: 1, when: [{ states: ["hover"], bg: 2 }] };
        expect(styleEquals(a, { fg: 1, when: [{ states: ["hover"], bg: 2 }] })).toBe(true);
        expect(styleEquals(a, { fg: 1, when: [{ states: ["focus"], bg: 2 }] })).toBe(false);
        expect(styleEquals(a, { fg: 1, when: [{ states: ["hover"], bg: 3 }] })).toBe(false);
        expect(styleEquals(a, { fg: 1, when: [] })).toBe(false);
        expect(styleEquals(a, { fg: 1 })).toBe(false);
        expect(styleEquals({ fg: 1 }, a)).toBe(false);
        expect(styleEquals(a, { fg: 1, when: [{ states: ["hover", "focus"], bg: 2 }] })).toBe(false);
    });

    it("расширенные поля подклассов участвуют в равенстве", () => {
        interface ExtendedStyle {
            fg?: number;
            panelTitleFg?: number;
        }
        const a: ExtendedStyle = { fg: 1, panelTitleFg: 2 };
        const b: ExtendedStyle = { fg: 1, panelTitleFg: 3 };
        expect(styleEquals(a, b)).toBe(false);
        expect(styleEquals(a, { fg: 1, panelTitleFg: 2 } as ExtendedStyle)).toBe(true);
        expect(styleEquals(a, { fg: 1 })).toBe(false);
    });
});

describe("mergeStyleVariants", () => {
    const активны = (states: string[]) => (sel: StyleStateSelector) => states.includes(sel);

    it("без when возвращает базовые fg/bg", () => {
        expect(mergeStyleVariants({ fg: 1, bg: 2 }, активны([]))).toEqual({ fg: 1, bg: 2 });
        expect(mergeStyleVariants({}, активны([]))).toEqual({ fg: undefined, bg: undefined });
    });

    it("активная запись перекрывает базу, неактивная — нет", () => {
        const style = { fg: 1, bg: 2, when: [{ states: ["hover"] as const, bg: 9 }] };
        expect(mergeStyleVariants(style, активны(["hover"]))).toEqual({ fg: 1, bg: 9 });
        expect(mergeStyleVariants(style, активны([]))).toEqual({ fg: 1, bg: 2 });
    });

    it("запись с fg-only не трогает bg (и наоборот)", () => {
        const style = { fg: 1, bg: 2, when: [{ states: ["focus"] as const, fg: 7 }] };
        expect(mergeStyleVariants(style, активны(["focus"]))).toEqual({ fg: 7, bg: 2 });
    });

    it("AND-семантика: запись активна, только когда активны ВСЕ селекторы", () => {
        const style = { when: [{ states: ["focus", "hover"] as const, bg: 5 }] };
        expect(mergeStyleVariants(style, активны(["focus"])).bg).toBeUndefined();
        expect(mergeStyleVariants(style, активны(["focus", "hover"])).bg).toBe(5);
    });

    it("позже объявленная активная запись побеждает", () => {
        const style = {
            bg: 1,
            when: [
                { states: ["hover"] as const, bg: 2 },
                { states: ["selected"] as const, bg: 3 },
            ],
        };
        expect(mergeStyleVariants(style, активны(["hover", "selected"])).bg).toBe(3);
        expect(mergeStyleVariants(style, активны(["hover"])).bg).toBe(2);
    });

    it("states: [] — безусловная запись, всегда активна", () => {
        const style = { bg: 1, when: [{ states: [] as const, bg: 4 }] };
        expect(mergeStyleVariants(style, активны([])).bg).toBe(4);
    });
});

describe("resolveStyle", () => {
    const parentFg = packRgb(200, 200, 200);
    const parentBg = packRgb(30, 30, 30);

    const inherited: ResolvedTUIStyle = {
        fg: parentFg,
        bg: parentBg,
    };

    it("empty style inherits fg/bg from parent", () => {
        const result = resolveStyle({}, inherited);
        expect(result.fg).toBe(parentFg);
        expect(result.bg).toBe(parentBg);
    });

    it("explicit fg overrides inherited", () => {
        const red = packRgb(255, 0, 0);
        const result = resolveStyle({ fg: red }, inherited);
        expect(result.fg).toBe(red);
        expect(result.bg).toBe(parentBg);
    });

    it("explicit bg overrides inherited", () => {
        const blue = packRgb(0, 0, 255);
        const result = resolveStyle({ bg: blue }, inherited);
        expect(result.fg).toBe(parentFg);
        expect(result.bg).toBe(blue);
    });

    it("INHERITED_FG resolves to parent fg", () => {
        const result = resolveStyle({ fg: INHERITED_FG }, inherited);
        expect(result.fg).toBe(parentFg);
    });

    it("INHERITED_BG resolves to parent bg", () => {
        const result = resolveStyle({ bg: INHERITED_BG }, inherited);
        expect(result.bg).toBe(parentBg);
    });

    it("explicit fg + bg both override", () => {
        const red = packRgb(255, 0, 0);
        const blue = packRgb(0, 0, 255);
        const result = resolveStyle({ fg: red, bg: blue }, inherited);
        expect(result.fg).toBe(red);
        expect(result.bg).toBe(blue);
    });

    it("3-level cascade: root → mid → leaf", () => {
        const rootFg = packRgb(255, 255, 255);
        const rootBg = packRgb(0, 0, 0);

        const rootResolved = resolveStyle({ fg: rootFg, bg: rootBg }, ROOT_RESOLVED_STYLE);
        expect(rootResolved.fg).toBe(rootFg);

        const midResolved = resolveStyle({}, rootResolved);
        expect(midResolved.fg).toBe(rootFg);

        const leafResolved = resolveStyle({}, midResolved);
        expect(leafResolved.fg).toBe(rootFg);
        expect(leafResolved.bg).toBe(rootBg);
    });

    it("mid-level override: root → mid(new fg) → leaf", () => {
        const rootFg = packRgb(255, 255, 255);
        const midFg = packRgb(128, 128, 128);

        const rootResolved = resolveStyle({ fg: rootFg }, ROOT_RESOLVED_STYLE);
        const midResolved = resolveStyle({ fg: midFg }, rootResolved);
        const leafResolved = resolveStyle({}, midResolved);

        expect(leafResolved.fg).toBe(midFg);
    });
});
