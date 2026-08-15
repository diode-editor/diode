import { afterEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";

import { createAppTestHarness, type IAppHarness } from "./AppTestHarness.ts";
import { tabLabels } from "./domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "./TempWorkspace.ts";

describe("createAppTestHarness", () => {
    let ws: ITempWorkspace | undefined;
    let h: IAppHarness | undefined;

    afterEach(() => {
        h?.dispose();
        ws?.dispose();
        h = undefined;
        ws = undefined;
    });

    it("бутит контроллер с воркспейсом, открывает файл и фокусирует редактор", () => {
        ws = createTempWorkspace({ files: { "alpha.txt": "Alpha content" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("alpha.txt"),
            focusEditor: true,
        });

        expect(tabLabels(h.testApp)).toEqual(["alpha.txt"]);
        expect(h.activeEditor()).toBeDefined();
        expect(h.commands.has("workbench.action.files.openFile")).toBe(true);
    });

    it("бутит без воркспейса с кастомным размером терминала", () => {
        h = createAppTestHarness({ size: new Size(100, 30) });

        expect(h.testApp.backend.getSize()).toEqual(new Size(100, 30));
        expect(tabLabels(h.testApp)).toEqual([]);
    });

    it("даёт доступ к контейнеру для suite-specific сервисов", () => {
        h = createAppTestHarness();

        expect(h.container.get).toBeDefined();
        expect(h.workbench.view).toBe(h.testApp.root);
    });
});
