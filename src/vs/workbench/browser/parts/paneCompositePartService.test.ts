import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it } from "vitest";

import { PaneCompositePartService } from "./paneCompositePartService.ts";

/** Subclass for a public constructor, like PanelService/AuxiliaryBarService. */
class TestPart extends PaneCompositePartService {}

function withViews(...ids: string[]): { part: TestPart; changes: number[]; active: string[] } {
    const part = new TestPart();
    for (const id of ids) part.addView({ id, title: id.toUpperCase() });
    const changes: number[] = [];
    const active: string[] = [];
    part.onDidChangeViews(() => changes.push(part.getViews().length));
    part.onDidChangeActiveView((id) => active.push(id));
    return { part, changes, active };
}

describe("PaneCompositePartService.removeView", () => {
    it("снятая активная вкладка передаёт активность первой оставшейся", () => {
        const { part, changes, active } = withViews("a", "b", "c");
        part.removeView("a");
        expect(part.getViews().map((v) => v.id)).toEqual(["b", "c"]);
        expect(part.getActiveViewId()).toBe("b");
        expect(changes).toEqual([2]);
        expect(active).toEqual(["b"]);
    });

    it("снятие неактивной вкладки активную не меняет и о смене не сообщает", () => {
        const { part, active } = withViews("a", "b");
        part.removeView("b");
        expect(part.getActiveViewId()).toBe("a");
        expect(active).toEqual([]);
    });

    it("снятие неактивной, когда активна не первая, — активность остаётся на месте", () => {
        const { part, active } = withViews("a", "b", "c");
        part.setActiveView("b");
        active.length = 0;
        part.removeView("c");
        expect(part.getActiveViewId()).toBe("b");
        expect(active).toEqual([]);
    });

    it("последняя снятая — активной нет", () => {
        const { part, active } = withViews("a");
        part.removeView("a");
        expect(part.getActiveViewId()).toBeNull();
        expect(active).toEqual([]);
    });

    it("неизвестный id — no-op", () => {
        const { part, changes } = withViews("a");
        part.removeView("ghost");
        expect(changes).toEqual([]);
    });
});

describe("PaneCompositePartService.requestTabContextMenu", () => {
    it("пересылает запрос подписчикам как есть", () => {
        const part = new TestPart();
        const owner = new TUIElement();
        const seen: unknown[] = [];
        part.onDidRequestTabContextMenu((request) => seen.push(request));
        part.requestTabContextMenu({ id: "a", anchor: { screenX: 1, screenY: 2 }, owner });
        expect(seen).toEqual([{ id: "a", anchor: { screenX: 1, screenY: 2 }, owner }]);
    });
});
