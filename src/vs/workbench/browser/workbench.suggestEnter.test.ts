import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import type { ICoreCompletionItem } from "../../editor/common/languages/iCompletionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

/**
 * Regression: `refineFilter` keeps the last non-empty set, the popup survived `{`,
 * and Enter (`acceptSelectedSuggestion` under `suggestWidgetVisible`) replaced `cons{`
 * with `console`.
 */
describe("Workbench — Enter после несловесного символа при открытом попапе", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    /** Items shaped like tsserver's: a shared range on all of them — the prefix boundary "from the provider". */
    const ITEMS: ICoreCompletionItem[] = [
        {
            label: "console",
            insertText: "console",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        },
        {
            label: "const",
            insertText: "const",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        },
    ];

    function editor(): EditorElement {
        return h.testApp.querySelector("EditorElement") as EditorElement;
    }

    /** Waits for the auto-suggest debounce (120 ms) and the provider's response. */
    function settle(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 300));
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-suggest-enter-", files: { "a.ts": "\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.ts") });
        h.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", {
            triggerCharacters: [],
            provideCompletionItems: () => Promise.resolve({ items: ITEMS, isIncomplete: false }),
        });
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("`{` закрывает попап, и Enter снова переносит строку", async () => {
        for (const char of "cons") h.testApp.sendKey(char);
        await settle();
        h.testApp.sendKey("{");
        await settle();

        h.testApp.sendKey("Enter");

        expect(editor().viewState.document.getText()).toBe("cons{\n    \n");
    });

    it("добор буквами попап не гасит — Enter всё ещё принимает пункт", async () => {
        for (const char of "cons") h.testApp.sendKey(char);
        await settle();
        h.testApp.sendKey("o");
        await settle();

        h.testApp.sendKey("Enter");

        expect(editor().viewState.document.getText()).toBe("console\n");
    });
});
