import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { BUBBLE_BADGE, bubbleFileDecorations } from "./bubbleFileDecorations.ts";

const ROOT = path.join(path.sep, "ws");
const p = (...segments: string[]): string => path.join(ROOT, ...segments);

describe("bubbleFileDecorations", () => {
    it("всплывает к каждой папке-предку до корня, сам корень не трогает", () => {
        const result = bubbleFileDecorations(
            [{ path: p("a", "b", "f.ts"), color: 1, badge: "M", propagate: true }],
            ROOT,
        );
        expect([...result]).toStrictEqual([
            [p("a", "b", "f.ts"), { color: 1, badge: "M" }],
            [p("a"), { color: 1, badge: BUBBLE_BADGE }],
            [p("a", "b"), { color: 1, badge: BUBBLE_BADGE }],
        ]);
    });

    it("без propagate (или с false) декорация остаётся только у самого пути", () => {
        const result = bubbleFileDecorations(
            [
                { path: p("a", "deleted.ts"), color: 1, badge: "D", propagate: false },
                { path: p("b", "plain.ts"), color: 2, badge: "M" },
            ],
            ROOT,
        );
        expect([...result.keys()]).toStrictEqual([p("a", "deleted.ts"), p("b", "plain.ts")]);
    });

    it("цвет папки — первого потомка в порядке дерева, независимо от порядка набора", () => {
        const result = bubbleFileDecorations(
            [
                { path: p("src", "z.ts"), color: 3, badge: "U", propagate: true },
                { path: p("src", "lib", "x.ts"), color: 2, badge: "A", propagate: true },
                { path: p("src", "b.ts"), color: 1, badge: "M", propagate: true },
            ],
            ROOT,
        );
        // Сегменты по алфавиту: «b.ts» < «lib» < «z.ts».
        expect(result.get(p("src"))).toStrictEqual({ color: 1, badge: BUBBLE_BADGE });
        expect(result.get(p("src", "lib"))).toStrictEqual({ color: 2, badge: BUBBLE_BADGE });
    });

    it("порядок набора не важен: обе перестановки дают один и тот же цвет", () => {
        const first = { path: p("d", "a.ts"), color: 1, badge: "M", propagate: true };
        const second = { path: p("d", "b.ts"), color: 2, badge: "M", propagate: true };
        expect(bubbleFileDecorations([first, second], ROOT).get(p("d"))?.color).toBe(1);
        expect(bubbleFileDecorations([second, first], ROOT).get(p("d"))?.color).toBe(1);
    });

    it("родитель раньше своих детей: декорация папки задаёт цвет её предкам", () => {
        const result = bubbleFileDecorations(
            [
                { path: p("a", "dir", "a.ts"), color: 2, badge: "M", propagate: true },
                { path: p("a", "dir"), color: 1, badge: "U", propagate: true },
            ],
            ROOT,
        );
        expect(result.get(p("a"))).toStrictEqual({ color: 1, badge: BUBBLE_BADGE });
        // Своя декорация папки — первой: цвет свой, а бейдж — «содержит изменения».
        expect(result.get(p("a", "dir"))).toStrictEqual({ color: 1, badge: BUBBLE_BADGE });
    });

    it("порядок — по сегментам, а не по строке пути: «a/…» раньше «a-b»", () => {
        // Строкой «x/a-b» < «x/a/z.ts» («-» < «/»), а по сегментам «a» < «a-b».
        const result = bubbleFileDecorations(
            [
                { path: p("x", "a-b"), color: 2, badge: "M", propagate: true },
                { path: p("x", "a", "z.ts"), color: 1, badge: "M", propagate: true },
            ],
            ROOT,
        );
        expect(result.get(p("x"))).toStrictEqual({ color: 1, badge: BUBBLE_BADGE });
        expect(result.has(p("x", "a", "z.ts"))).toBe(true);
    });

    it("потомок без цвета не мешает цвету следующего; бейдж всплытия есть и без цвета", () => {
        const result = bubbleFileDecorations(
            [
                { path: p("d", "a.ts"), badge: "M", propagate: true },
                { path: p("d", "b.ts"), color: 5, badge: "M", propagate: true },
                { path: p("e", "only.ts"), badge: "M", propagate: true },
            ],
            ROOT,
        );
        expect(result.get(p("d"))).toStrictEqual({ color: 5, badge: BUBBLE_BADGE });
        expect(result.get(p("e"))).toStrictEqual({ color: undefined, badge: BUBBLE_BADGE });
    });

    it("путь вне корня и сам корень не всплывают", () => {
        const result = bubbleFileDecorations(
            [
                { path: path.join(path.sep, "other", "f.ts"), color: 1, badge: "M", propagate: true },
                { path: path.join(path.sep, "ws-sibling", "f.ts"), color: 1, badge: "M", propagate: true },
                { path: ROOT, color: 1, badge: "M", propagate: true },
            ],
            ROOT,
        );
        expect([...result.keys()]).toStrictEqual([
            path.join(path.sep, "other", "f.ts"),
            path.join(path.sep, "ws-sibling", "f.ts"),
            ROOT,
        ]);
        expect(result.get(ROOT)).toStrictEqual({ color: 1, badge: "M" });
    });

    it("имя, начинающееся с «..», лежит под корнем и всплывает", () => {
        const result = bubbleFileDecorations(
            [{ path: p("..hidden", "f.ts"), color: 1, badge: "M", propagate: true }],
            ROOT,
        );
        expect(result.get(p("..hidden"))).toStrictEqual({ color: 1, badge: BUBBLE_BADGE });
    });
});
