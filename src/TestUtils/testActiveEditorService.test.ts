import { describe, expect, it, vi } from "vitest";

import { createTestActiveEditorService } from "./testActiveEditorService.ts";
import { createEditorPane } from "./TextEditorPaneFactory.ts";

describe("createTestActiveEditorService", () => {
    it("роль «активный редактор» отдаёт один и тот же редактор", () => {
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

    it("без редактора — null, а focusEditor безвреден", () => {
        const service = createTestActiveEditorService(null);

        expect(service.getActiveEditor()).toBeNull();
        expect(service.getActiveViewState()).toBeNull();
        expect(() => {
            service.focusEditor();
        }).not.toThrow();
    });

    it("член вне роли бросает с его именем; служебные пробы рантайма — undefined", () => {
        const service = createTestActiveEditorService(null);

        expect(() => service.getEditors()).toThrow(/«getEditors» вне роли/);
        // `await service` и инспекция по символам не должны падать.
        expect((service as unknown as { then?: unknown }).then).toBeUndefined();
        expect((service as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
    });
});
