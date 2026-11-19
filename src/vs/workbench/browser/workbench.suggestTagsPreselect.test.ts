import { Point } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { settle } from "../../../TestUtils/timing.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { CompletionItemTag, type ICoreCompletionItem } from "../../editor/common/languages/iCompletionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { SuggestComponentDIToken } from "../contrib/suggest/browser/suggestComponent.ts";

/** `CompletionItemTag.Deprecated` strikes the label through; `preselect` moves the selection, as upstream. */
describe("Workbench: completion tags and preselect", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let items: ICoreCompletionItem[];

    function item(label: string, extra: Partial<ICoreCompletionItem> = {}): ICoreCompletionItem {
        return { label, insertText: label, kind: 2, ...extra };
    }

    function editor(): EditorElement {
        return h.testApp.querySelector("EditorElement") as EditorElement;
    }

    function selectedLabel(): string | undefined {
        return h.container.get(SuggestComponentDIToken).view.getSelectedItem()?.label;
    }

    /** Types, then waits for the auto-suggest debounce (120 ms) and the provider's response. */
    async function type(text: string): Promise<void> {
        typeText(h.testApp, text);
        await settle(300);
    }

    /** Screen position of the first cell of `label` in the frame. */
    function find(label: string): Point {
        h.testApp.render();
        const rows = h.testApp.backend.screenToString().split("\n");
        const y = rows.findIndex((row) => row.includes(` ${label}`));
        expect(y, `${label} in the frame`).toBeGreaterThanOrEqual(0);
        return new Point(rows[y].indexOf(` ${label}`) + 1, y);
    }

    function stylesOf(label: string): number[] {
        const at = find(label);
        return Array.from(
            { length: label.length },
            (_, i) => h.testApp.app.screen.getCell(new Point(at.x + i, at.y)).style & StyleFlags.Strikethrough,
        );
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-suggest-tags-", files: { "a.ts": "\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.ts") });
        items = [];
        h.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", {
            triggerCharacters: [],
            provideCompletionItems: () => Promise.resolve({ items, isIncomplete: false }),
        });
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("a deprecated item's label is struck through in the frame, a regular one is not", async () => {
        items = [item("oldFn", { tags: [CompletionItemTag.Deprecated] }), item("otherFn")];
        await type("o");
        expect(stylesOf("oldFn")).toEqual(Array(5).fill(StyleFlags.Strikethrough));
        expect(stylesOf("otherFn")).toEqual(Array(7).fill(0));
    });

    it("the popup opens on the first preselect item among the prefix matches, and Enter inserts it", async () => {
        items = [item("oneFn"), item("onePick", { preselect: true }), item("anotherOne", { preselect: true })];
        await type("on");
        expect(selectedLabel()).toBe("onePick");
        // Narrowing re-applies it.
        await type("e");
        expect(selectedLabel()).toBe("onePick");
        h.testApp.sendKey("Enter");
        await settle(300);
        expect(editor().viewState.document.getText()).toBe("onePick\n");
    });

    it("a preselect item that only matches inside the word does not pull the selection", async () => {
        items = [item("oneFn"), item("anotherOne", { preselect: true })];
        await type("on");
        expect(selectedLabel()).toBe("oneFn");
    });
});
