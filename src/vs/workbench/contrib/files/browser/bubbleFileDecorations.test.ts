import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { BUBBLE_BADGE, bubbleFileDecorations } from "./bubbleFileDecorations.ts";

const ROOT = path.join(path.sep, "ws");
const p = (...segments: string[]): string => path.join(ROOT, ...segments);

describe("bubbleFileDecorations", () => {
    it("bubbles up to every ancestor folder up to the root, leaving the root itself alone", () => {
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

    it("without propagate (or with false) the decoration stays on the path itself", () => {
        const result = bubbleFileDecorations(
            [
                { path: p("a", "deleted.ts"), color: 1, badge: "D", propagate: false },
                { path: p("b", "plain.ts"), color: 2, badge: "M" },
            ],
            ROOT,
        );
        expect([...result.keys()]).toStrictEqual([p("a", "deleted.ts"), p("b", "plain.ts")]);
    });

    it("a folder's color is the first descendant's in tree order, regardless of set order", () => {
        const result = bubbleFileDecorations(
            [
                { path: p("src", "z.ts"), color: 3, badge: "U", propagate: true },
                { path: p("src", "lib", "x.ts"), color: 2, badge: "A", propagate: true },
                { path: p("src", "b.ts"), color: 1, badge: "M", propagate: true },
            ],
            ROOT,
        );
        // Segments sort alphabetically: "b.ts" < "lib" < "z.ts".
        expect(result.get(p("src"))).toStrictEqual({ color: 1, badge: BUBBLE_BADGE });
        expect(result.get(p("src", "lib"))).toStrictEqual({ color: 2, badge: BUBBLE_BADGE });
    });

    it("set order does not matter: both permutations give the same color", () => {
        const first = { path: p("d", "a.ts"), color: 1, badge: "M", propagate: true };
        const second = { path: p("d", "b.ts"), color: 2, badge: "M", propagate: true };
        expect(bubbleFileDecorations([first, second], ROOT).get(p("d"))?.color).toBe(1);
        expect(bubbleFileDecorations([second, first], ROOT).get(p("d"))?.color).toBe(1);
    });

    it("the first differing segment wins over length: 'a/x.ts' before 'z.ts'", () => {
        // The shorter path has the greater segment: by length it would come first.
        const result = bubbleFileDecorations(
            [
                { path: p("d", "a", "x.ts"), color: 2, badge: "M", propagate: true },
                { path: p("d", "z.ts"), color: 1, badge: "M", propagate: true },
            ],
            ROOT,
        );
        expect(result.get(p("d"))?.color).toBe(2);
    });

    it("a parent comes before its children: a folder's decoration sets its ancestors' color", () => {
        const result = bubbleFileDecorations(
            [
                { path: p("a", "dir", "a.ts"), color: 2, badge: "M", propagate: true },
                { path: p("a", "dir"), color: 1, badge: "U", propagate: true },
            ],
            ROOT,
        );
        expect(result.get(p("a"))).toStrictEqual({ color: 1, badge: BUBBLE_BADGE });
        // The folder's own decoration comes first: its own color, but the "contains changes" badge.
        expect(result.get(p("a", "dir"))).toStrictEqual({ color: 1, badge: BUBBLE_BADGE });
    });

    it("order is by segments, not by the path string: 'a/…' before 'a-b'", () => {
        // As strings "x/a-b" < "x/a/z.ts" ("-" < "/"), but by segments "a" < "a-b".
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

    it("a descendant without color does not block the next one's color; the bubble badge exists without color too", () => {
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

    it("a path outside the root and the root itself do not bubble", () => {
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

    it("a name starting with '..' is under the root and bubbles", () => {
        const result = bubbleFileDecorations(
            [{ path: p("..hidden", "f.ts"), color: 1, badge: "M", propagate: true }],
            ROOT,
        );
        expect(result.get(p("..hidden"))).toStrictEqual({ color: 1, badge: BUBBLE_BADGE });
    });
});
