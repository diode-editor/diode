import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { HoverServiceDIToken } from "./hoverService.ts";

describe("hoverActions — commands and keybindings", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-hover-actions-", files: { "main.ts": "const answer = 1;\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
        h.container.get(LanguageFeaturesServiceDIToken).hoverProvider.register("*", {
            provideHover: () => Promise.resolve({ contents: ["const answer: number"] }),
        });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const service = () => h.container.get(HoverServiceDIToken);

    it("editor.action.showHover opens the popup, editor.action.hideHover closes it", async () => {
        h.commands.execute("editor.action.showHover");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(true);

        h.commands.execute("editor.action.hideHover");
        expect(service().isOpen()).toBe(false);
    });

    it("show is a chord: Ctrl+K alone doesn't open, Ctrl+K Ctrl+U does", async () => {
        h.testApp.sendKey("Ctrl+K");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(false);

        h.testApp.sendKey("Ctrl+U");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(true);
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()?.getText()).toBe("const answer = 1;\n");
    });
});
