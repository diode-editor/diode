import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";

/**
 * Found on the stock Even Better TOML (#971): taplo has `[` as a trigger character and answers an unknown table header
 * with nothing. Upstream asks only the providers that own the trigger character (`providerFilter` in `suggestModel.ts`),
 * so buffer words do not open on it, and a word that matches nothing shows no popup. Here `[dep` + Enter gave `[package]`.
 */
describe("Workbench: a trigger character whose provider has nothing", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function text(): string {
        return (h.testApp.querySelector("EditorElement") as EditorElement).viewState.document.getText();
    }

    /** Waits for the auto-suggest debounce (120 ms) and the provider's response. */
    function settle(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 300));
    }

    async function typeSlowly(chars: string): Promise<void> {
        for (const char of chars) {
            h.testApp.sendKey(char);
            await settle();
        }
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-suggest-trigger-", files: { "a.txt": "package name other\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.txt") });
        h.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", {
            triggerCharacters: ["#"],
            provideCompletionItems: () => Promise.resolve({ items: [], isIncomplete: false }),
        });
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+End");
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("the trigger character does not open the list of buffer words", async () => {
        await typeSlowly("#");

        h.testApp.render();
        // The word stands once in the buffer: a second one in the frame is the popup.
        expect(h.testApp.backend.screenToString().match(/package/g)).toHaveLength(1);
    });

    it("Enter after a word that matches nothing breaks the line and keeps the word", async () => {
        await typeSlowly("#dep");

        h.testApp.sendKey("Enter");

        expect(text()).toBe("package name other\n#dep\n");
    });
});
