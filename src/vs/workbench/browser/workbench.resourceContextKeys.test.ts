import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import {
    type ILanguageService,
    LanguageServiceDIToken,
    NULL_LANGUAGE_SERVICE,
} from "../../editor/common/languages/iLanguageService.ts";
import { KeybindingRegistryDIToken, parseKeybinding } from "../../platform/keybinding/common/keybindingRegistry.ts";

// The binding shape of the stock clangd's `clangd.switchheadersource` (Alt+O). It went unanswered: nothing set
// `resourceLangId`, so the when clause was false in every editor.

const CPP_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".cpp") ? "cpp" : undefined),
};

describe("Workbench — resource* when keys", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("a keybinding gated on resourceLangId fires in an editor of that language only", () => {
        ws = createTempWorkspace({ prefix: "diode-resource-keys-", files: { "a.cpp": "int a;\n", "b.txt": "b\n" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.cpp"),
            focusEditor: true,
            containerOverrides: (container) => {
                container.bind(LanguageServiceDIToken, () => CPP_LANGUAGE_SERVICE);
            },
        });
        const runs: string[] = [];
        h.commands.register("demo.switchHeaderSource", () => {
            runs.push("switch");
        });
        h.container
            .get(KeybindingRegistryDIToken)
            .register(
                parseKeybinding("alt+o"),
                "demo.switchHeaderSource",
                "(resourceLangId == c || resourceLangId == cpp) && editorTextFocus",
                "extension",
            );

        h.testApp.sendKey("Alt+o");
        expect(runs).toStrictEqual(["switch"]);

        h.workbench.openFile(ws.path("b.txt"));
        h.workbench.focusEditor();
        h.testApp.sendKey("Alt+o");
        expect(runs).toStrictEqual(["switch"]);
    });
});
