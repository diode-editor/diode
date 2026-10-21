import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";

describe("TextEditorPane.onDidType", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-on-did-type-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function open(content: string): TextEditorPane {
        const pane = createEditorPane();
        pane.openFile(Uri.file(ws.writeFile("a.txt", content)));
        return pane;
    }

    function press(pane: TextEditorPane, key: string): void {
        pane.component.view.getChild().dispatchEvent(new TUIKeyboardEvent("keypress", { key }));
    }

    it("typing reaches the pane subscriber; unsubscribing removes it", () => {
        const pane = open("");
        const typed: string[] = [];
        const subscription = pane.onDidType((text) => typed.push(text));
        const other: string[] = [];
        pane.onDidType((text) => other.push(text));

        press(pane, "a");
        subscription.dispose();
        // A repeated unsubscribe is harmless and does not remove someone else's listener (the last in the list).
        subscription.dispose();
        press(pane, "b");

        expect(typed).toEqual(["a"]);
        expect(other).toEqual(["a", "b"]);
    });

    it("an untitled buffer (widget from the constructor, no reload) also emits typing", () => {
        const pane = createEditorPane();
        const typed: string[] = [];
        pane.onDidType((text) => typed.push(text));

        press(pane, "a");

        expect(typed).toEqual(["a"]);
    });

    it("the subscription survives a file reload from disk (the widget is recreated)", () => {
        const pane = open("x");
        const typed: string[] = [];
        pane.onDidType((text) => typed.push(text));

        pane.revertToDisk();
        press(pane, "y");

        expect(typed).toEqual(["y"]);
    });

    it("a sibling unsubscribed mid-delivery and not yet reached no longer receives the character", () => {
        const pane = open("");
        const seen: string[] = [];
        let neighbour = { dispose: (): void => undefined };
        pane.onDidType(() => {
            neighbour.dispose();
        });
        neighbour = pane.onDidType((text) => seen.push(text));

        press(pane, "a");
        press(pane, "b");

        // Emitter guarantee (docs/arch/Common.md#события-eventts, G2): a removed listener is not called.
        expect(seen).toEqual([]);
    });
});
