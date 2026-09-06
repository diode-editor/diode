import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { HoverServiceDIToken } from "./hoverService.ts";

describe("hoverActions — команды и кейбинды", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-hover-actions-", files: { "main.ts": "const answer = 1;\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
        h.container.get(EditorServiceDIToken).hoverSource = () =>
            Promise.resolve([{ contents: ["const answer: number"] }]);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const service = () => h.container.get(HoverServiceDIToken);

    it("editor.action.showHover открывает попап, editor.action.hideHover закрывает", async () => {
        h.commands.execute("editor.action.showHover");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(true);

        h.commands.execute("editor.action.hideHover");
        expect(service().isOpen()).toBe(false);
    });

    it("показ — второй бинд Alt+Q, буква в буфер не попадает", async () => {
        h.testApp.sendKey("Alt+q");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(true);
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()?.getText()).toBe("const answer = 1;\n");
    });

    it("показ — основной бинд чордом: одиночный Ctrl+K не открывает, Ctrl+K Ctrl+U открывает", async () => {
        h.testApp.sendKey("Ctrl+K");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(false);

        h.testApp.sendKey("Ctrl+U");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(true);
        // Ни прелюдия чорда, ни Ctrl+U не тронули буфер.
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()?.getText()).toBe("const answer = 1;\n");
    });
});
