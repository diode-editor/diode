import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";

/**
 * Провод `onDidType` от `EditorElement` до панели: подписчик панели слышит
 * набор, и подписка переживает пересоздание виджета при перечитке файла.
 */
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

    it("набор доходит до подписчика панели; отписка его снимает", () => {
        const pane = open("");
        const typed: string[] = [];
        const subscription = pane.onDidType((text) => typed.push(text));
        const other: string[] = [];
        pane.onDidType((text) => other.push(text));

        press(pane, "a");
        subscription.dispose();
        // Повторная отписка безвредна и не снимает чужого (последнего в списке).
        subscription.dispose();
        press(pane, "b");

        expect(typed).toEqual(["a"]);
        expect(other).toEqual(["a", "b"]);
    });

    it("безымянный буфер (виджет из конструктора, без перечитки) тоже шлёт набор", () => {
        const pane = createEditorPane();
        const typed: string[] = [];
        pane.onDidType((text) => typed.push(text));

        press(pane, "a");

        expect(typed).toEqual(["a"]);
    });

    it("подписка переживает перечитку файла с диска (виджет пересоздаётся)", () => {
        const pane = open("x");
        const typed: string[] = [];
        pane.onDidType((text) => typed.push(text));

        pane.revertToDisk();
        press(pane, "y");

        expect(typed).toEqual(["y"]);
    });

    it("рассылка идёт по снапшоту: отписанный посреди неё сосед символ ещё получает", () => {
        const pane = open("");
        const seen: string[] = [];
        let neighbour = { dispose: (): void => undefined };
        pane.onDidType(() => {
            neighbour.dispose();
        });
        neighbour = pane.onDidType((text) => seen.push(text));

        press(pane, "a");
        press(pane, "b");

        expect(seen).toEqual(["a"]);
    });
});
