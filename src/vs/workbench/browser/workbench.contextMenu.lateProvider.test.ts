import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";

function rightClick(x: number, y: number, action: "press" | "release"): MouseToken {
    return {
        kind: "mouse",
        button: "right",
        x: x + 1,
        y: y + 1,
        action,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

describe("Workbench — the editor context menu after a language server comes up", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-ctxmenu-late-",
            files: { "alpha.txt": "hello world\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 40) });
        await h.workbench.activate();
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.focusEditor();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("a provider registered after the file opened: the first right click offers Go to Implementations", () => {
        // The file is open and nothing has been pressed; now the language server registers its provider.
        h.container
            .get(LanguageFeaturesServiceDIToken)
            .implementationProvider.register("*", { provideImplementation: () => Promise.resolve([]) });
        h.testApp.render();

        const caret = (h.testApp.querySelector("EditorElement") as EditorElement).getCaretScreenCell();
        if (caret === null) throw new Error("no caret");
        h.testApp.backend.simulateMouse(rightClick(caret.x, caret.y, "press"));
        h.testApp.backend.simulateMouse(rightClick(caret.x, caret.y, "release"));
        h.testApp.render();

        expect(h.testApp.querySelector("PopupMenuElement")).not.toBeNull();
        expect(h.testApp.backend.screenToString()).toContain("Go to Implementations");
    });
});
