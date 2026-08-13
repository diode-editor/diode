import { describe, expect, it } from "vitest";

import type { NodeSnapshot } from "@tuidom/all/inspector/protocol";

import { $, $$, boxOf, centerOf, focusedLeaf, focusPath } from "./query.ts";

// Пуристый unit по матчеру локаторов — без бинаря; строим снимок вручную.
function node(type: string, over: Partial<NodeSnapshot> = {}, children: NodeSnapshot[] = []): NodeSnapshot {
    return {
        nodeId: 0,
        type,
        box: { x: 0, y: 0, width: 4, height: 2 },
        style: { fg: 0, bg: 0 },
        focused: false,
        children,
        ...over,
    };
}

const tree = node("BodyElement", { focused: true }, [
    node("PanelContainerElement", { id: "panel", focused: true }, [
        node("SelectBoxElement", { role: "combobox", focused: true, box: { x: 10, y: 4, width: 6, height: 1 } }),
    ]),
    node("EditorElement", {}, [node("SelectBoxElement")]),
]);

describe("query locators", () => {
    it("matches by tag, #id and @role", () => {
        expect($(tree, "PanelContainerElement")?.id).toBe("panel");
        expect($(tree, "#panel")?.type).toBe("PanelContainerElement");
        expect($(tree, "@combobox")?.type).toBe("SelectBoxElement");
    });

    it("$$ returns every match; descendant combinator scopes it", () => {
        expect($$(tree, "SelectBoxElement")).toHaveLength(2);
        // Только тот SelectBox, что под панелью.
        const scoped = $$(tree, "PanelContainerElement SelectBoxElement");
        expect(scoped).toHaveLength(1);
        expect(scoped[0].role).toBe("combobox");
    });

    it("returns null / empty for a null root or no match", () => {
        expect($(null, "X")).toBeNull();
        expect($$(null, "X")).toEqual([]);
        expect($(tree, "NoSuchElement")).toBeNull();
    });

    it("boxOf and centerOf resolve geometry, boxOf throws when missing", () => {
        expect(boxOf(tree, "@combobox")).toEqual({ x: 10, y: 4, width: 6, height: 1 });
        expect(centerOf(tree, "@combobox")).toEqual({ x: 13, y: 4 });
        expect(() => boxOf(tree, "Missing")).toThrow(/locator not found/u);
    });

    it("focusedLeaf and focusPath walk the focus chain", () => {
        expect(focusedLeaf(tree)?.type).toBe("SelectBoxElement");
        expect(focusPath(tree)).toEqual(["BodyElement", "PanelContainerElement", "SelectBoxElement"]);
        expect(focusedLeaf(null)).toBeNull();
    });
});
