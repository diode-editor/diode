import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";

describe("EditorComponent — onDidChangeIndentOptions", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-indent-events-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function openPane(name: string, content: string): TextEditorPane {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(ws.writeFile(name, content)));
        return ctrl;
    }

    function countEvents(ctrl: TextEditorPane): { count: () => number } {
        let fired = 0;
        ctrl.onDidChangeIndentOptions(() => {
            fired++;
        });
        return { count: () => fired };
    }

    it("fires on a change from setIndentOptions", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        ctrl.setIndentOptions({ tabSize: 2, insertSpaces: true });

        expect(events.count()).toBe(1);
    });

    it("stays silent when the patch matches the current values", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        ctrl.setIndentOptions({ tabSize: 4, insertSpaces: false });

        expect(events.count()).toBe(0);
    });

    it("fires on a change from applyIndentConfiguration", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        ctrl.applyIndentConfiguration({ tabSize: 8, insertSpaces: true, detectIndentation: false });

        expect(events.count()).toBe(1);
    });

    it("fires when the config changed only the tab size (tabSize)", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        // insertSpaces stays false — only tabSize changes.
        ctrl.applyIndentConfiguration({ tabSize: 8, detectIndentation: false });

        expect(events.count()).toBe(1);
        expect(ctrl.viewState.insertSpaces).toBe(false);
    });

    it("fires when the config changed only the indent kind (insertSpaces)", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        // tabSize stays 4 — only insertSpaces changes.
        ctrl.applyIndentConfiguration({ insertSpaces: true, detectIndentation: false });

        expect(events.count()).toBe(1);
        expect(ctrl.viewState.tabSize).toBe(4);
    });

    it("stays silent when the config did not change the current values", () => {
        const ctrl = openPane("a.ts", "x");
        const events = countEvents(ctrl);

        ctrl.applyIndentConfiguration({ tabSize: 4, insertSpaces: false, detectIndentation: false });

        expect(events.count()).toBe(0);
    });

    it("fires when opening a file re-detected the indentation", () => {
        const ctrl = createEditorPane();
        const events = countEvents(ctrl);

        // Two-space indentation: detection switches the default tabs to Spaces: 2.
        ctrl.openFile(Uri.file(ws.writeFile("a.ts", "if (a) {\n  b();\n  c();\n}\n")));

        expect(events.count()).toBe(1);
        expect(ctrl.viewState.insertSpaces).toBe(true);
        expect(ctrl.viewState.tabSize).toBe(2);
    });

    it("the subscription survives a document reload (fires after it too)", () => {
        const ctrl = openPane("a.ts", "if (a) {\n  b();\n  c();\n}\n");
        const events = countEvents(ctrl);

        // A reload recreates the view state; the subscription lives on the component.
        ctrl.openFile(Uri.file(ws.writeFile("b.ts", "if (a) {\n\tb();\n\tc();\n}\n")));

        expect(events.count()).toBe(1);
        expect(ctrl.viewState.insertSpaces).toBe(false);
    });

    it("stays silent on reload when detection yields the same indentation", () => {
        const ctrl = openPane("a.ts", "if (a) {\n  b();\n  c();\n}\n");
        const events = countEvents(ctrl);

        // Another file with the same two-space indentation: the view state is recreated,
        // but the effective values did not change — no event needed.
        ctrl.openFile(Uri.file(ws.writeFile("b.ts", "if (x) {\n  y();\n}\n")));

        expect(events.count()).toBe(0);
    });

    it("disposing a subscription stops delivery and does not affect its sibling", () => {
        const ctrl = openPane("a.ts", "x");
        let firstFired = 0;
        let secondFired = 0;
        const first = ctrl.onDidChangeIndentOptions(() => {
            firstFired++;
        });
        ctrl.onDidChangeIndentOptions(() => {
            secondFired++;
        });

        first.dispose();
        // A repeated dispose is a no-op: the other subscription must not be affected.
        first.dispose();
        ctrl.setIndentOptions({ tabSize: 2 });

        expect(firstFired).toBe(0);
        expect(secondFired).toBe(1);
    });
});
