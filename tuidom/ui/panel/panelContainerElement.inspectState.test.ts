import { describe, expect, it } from "vitest";

import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";

import { PanelContainerElement } from "./panelContainerElement.ts";

// Геометрия таб-строки (см. TAB_INDENT=1, TAB_PAD=1, TAB_ROW=1):
// "PROBLEMS" (8) → сегмент [1, 11); "OUTPUT" (6) → [11, 19).
describe("PanelContainerElement.inspectState", () => {
    it("reports tabs with absolute hit geometry and the active id", () => {
        const panel = new PanelContainerElement();
        panel.addView({ id: "a", title: "PROBLEMS", content: null });
        panel.addView({ id: "b", title: "OUTPUT", content: null });
        panel.setActiveView("b");
        panel.localPosition = new Offset(0, 0);
        panel.layout(BoxConstraints.tight(new Size(40, 8)));

        const state = panel.inspectState();
        expect(state.activeId).toBe("b");
        expect(state.tabRow).toBe(1);
        expect(state.tabs).toEqual([
            { id: "a", title: "PROBLEMS", active: false, x: 1, width: 10, centerX: 6 },
            { id: "b", title: "OUTPUT", active: true, x: 11, width: 8, centerX: 15 },
        ]);
    });

    it("offsets tab x by the panel's global position", () => {
        const panel = new PanelContainerElement();
        panel.addView({ id: "a", title: "PROBLEMS", content: null });
        panel.localPosition = new Offset(30, 12);
        panel.layout(BoxConstraints.tight(new Size(40, 8)));

        const state = panel.inspectState();
        expect(state.tabRow).toBe(13);
        expect((state.tabs as { x: number }[])[0].x).toBe(31);
    });
});
