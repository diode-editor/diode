import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TreeViewElement } from "@tuidom/all/ui/tree/treeViewElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";

// Damage-tracking кадра на уровне воркбенча (docs/TODO/LongLinePerformance.md,
// «Глубже»): клавиша в редакторе не должна перерисовывать чужие панели.
// Ключевая механика — fallback-вариант страховки consumed-key
// (workbenchComponent.mount): команда, честно пометившая виджет, даёт
// частичный damage вместо markDirty корня (= полноэкранного кадра).

describe("Workbench — damage клавиши в редакторе не задевает чужие панели", () => {
    let h: IAppHarness;

    beforeEach(() => {
        h = createAppTestHarness();
    });

    afterEach(() => {
        h.dispose();
    });

    it("стрелка в редакторе не рендерит дерево файлов", () => {
        h.workbench.openFile("/tmp/damage-scope.txt");
        h.workbench.focusEditor();
        h.testApp.render();

        const treeRenderSpy = vi.spyOn(TreeViewElement.prototype, "render");
        h.testApp.sendKey("ArrowDown");

        // Кадр был (движение курсора — dirty), но дерево файлов в него не вошло.
        expect(treeRenderSpy).not.toHaveBeenCalled();
        treeRenderSpy.mockRestore();
    });
});
