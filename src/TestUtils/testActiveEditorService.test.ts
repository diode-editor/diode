import { describe, expect, it, vi } from "vitest";

import { createTestActiveEditorService } from "./testActiveEditorService.ts";
import { createEditorPane } from "./TextEditorPaneFactory.ts";

describe("createTestActiveEditorService", () => {
    it('the "active editor" role returns the same editor', () => {
        const pane = createEditorPane();
        const service = createTestActiveEditorService(pane);

        expect(service.getActivePane()).toBe(pane);
        expect(service.getActiveTabPane()).toBe(pane);
        expect(service.getActiveEditor()).toBe(pane);
        expect(service.getActiveTabEditor()).toBe(pane);
        expect(service.getActiveViewState()).toBe(pane.viewState);

        const focus = vi.spyOn(pane, "focusEditor");
        service.focusEditor();
        expect(focus).toHaveBeenCalledOnce();
    });

    it("no editor — null, and focusEditor is harmless", () => {
        const service = createTestActiveEditorService(null);

        expect(service.getActiveEditor()).toBeNull();
        expect(service.getActiveViewState()).toBeNull();
        expect(() => {
            service.focusEditor();
        }).not.toThrow();
    });

    it("a member outside the role throws with its name; runtime probes get undefined", () => {
        const service = createTestActiveEditorService(null);

        expect(() => service.getEditors()).toThrow(/"getEditors" is outside the "active editor" role/);
        // `await service` and symbol-based inspection must not throw.
        expect((service as unknown as { then?: unknown }).then).toBeUndefined();
        expect((service as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
    });
});
