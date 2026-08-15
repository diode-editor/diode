import { afterEach, describe, expect, it, vi } from "vitest";

import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIElement } from "@tuidom/core/dom/tuiElement";

import { createAppTestHarness, type IAppHarness } from "./AppTestHarness.ts";
import { quickPickByTitle, tabLabels, typeText } from "./domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "./TempWorkspace.ts";
import { TestApp } from "./TestApp.ts";

describe("domQueries", () => {
    let ws: ITempWorkspace | undefined;
    let h: IAppHarness | undefined;

    afterEach(() => {
        h?.dispose();
        ws?.dispose();
        h = undefined;
        ws = undefined;
    });

    it("quickPickByTitle находит открытый промпт по заголовку", () => {
        ws = createTempWorkspace();
        h = createAppTestHarness({ workspaceFolder: ws.dir });

        h.commands.execute("workbench.action.files.openFile");
        h.testApp.render();

        const input = quickPickByTitle(h.testApp, "Open File");
        expect(input.title).toBe("Open File");
        expect(input.getQuery()).toBe("");
    });

    it("tabLabels возвращает ярлыки вкладок в порядке отображения", () => {
        ws = createTempWorkspace({
            files: { "alpha.txt": "Alpha", "beta.txt": "Beta" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("alpha.txt") });
        h.workbench.openFile(ws.path("beta.txt"));
        h.testApp.render();

        expect(tabLabels(h.testApp)).toEqual(["alpha.txt", "beta.txt"]);
    });

    it("typeText шлёт каждый символ отдельным sendKey", () => {
        const target = new TUIElement();
        target.focusable = true;
        const testApp = TestApp.createWithContent(target);
        target.focus();

        const handler = vi.fn<(event: TUIKeyboardEvent) => void>();
        target.addEventListener("keydown", handler);
        typeText(testApp, "abc");

        expect(handler).toHaveBeenCalledTimes(3);
        expect(handler.mock.calls.map((call) => call[0].key)).toEqual(["a", "b", "c"]);
    });
});
