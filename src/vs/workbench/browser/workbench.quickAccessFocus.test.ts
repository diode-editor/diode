import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { SymbolKind } from "../../editor/common/languages/symbolKinds.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";

const SOURCE = "first\nsecond\nthird\n";

// Upstream `gotoLocation`: accepting a location focuses the editor, wherever the picker was opened from. The picker
// itself gives the focus back to its opener, so without this the next key would go to the panel.
describe("Workbench — accepting a location in quick access focuses the editor", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-quickaccess-focus-", files: { "a.txt": SOURCE } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(100, 30), openFile: ws.path("a.txt") });
        h.commands.execute("workbench.view.explorer");
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("the next key after Go to Line from the sidebar types at that line", async () => {
        h.testApp.sendKey("x");
        h.testApp.render();
        // The control: from the sidebar a key does not reach the buffer.
        expect(h.activeEditor().viewState.document.getLineContent(0)).toBe("first");

        h.commands.execute("workbench.action.gotoLine");
        await flushMicrotasks();
        h.testApp.sendKey("2");
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        h.testApp.render();

        h.testApp.sendKey("x");
        h.testApp.render();
        expect(h.activeEditor().viewState.document.getLineContent(1)).toBe("xsecond");
    });

    it("the next key after Go to Symbol from the sidebar types at the symbol", async () => {
        const range = createRange(2, 0, 2, 5);
        h.container.get(LanguageFeaturesServiceDIToken).documentSymbolProvider.register("*", {
            provideDocumentSymbols: () =>
                Promise.resolve([
                    {
                        name: "third",
                        detail: "",
                        kind: SymbolKind.Function,
                        tags: [],
                        range,
                        selectionRange: range,
                        children: [],
                    },
                ]),
        });

        h.commands.execute("workbench.action.gotoSymbol");
        await flushMicrotasks();
        h.testApp.render();
        h.testApp.sendKey("Enter");
        await flushMicrotasks();
        h.testApp.render();

        h.testApp.sendKey("x");
        h.testApp.render();
        expect(h.activeEditor().viewState.document.getLineContent(2)).toBe("xthird");
    });
});
