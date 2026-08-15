import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";

describe("TextFileModel EOL", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-editorctrl-eol-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content: string): string {
        return ws.writeFile(name, content);
    }

    it("opens a CRLF file without marking it modified", () => {
        const filePath = writeFile("crlf.txt", "a\r\nb\r\nc");
        const ctrl = createEditorPane();

        ctrl.openFile(Uri.file(filePath));

        expect(ctrl.eol).toBe(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(false);
    });

    it("round-trips a CRLF file byte-for-byte on save", async () => {
        const original = "line1\r\nline2\r\nline3\r\n";
        const filePath = writeFile("crlf.txt", original);
        const ctrl = createEditorPane();

        ctrl.openFile(Uri.file(filePath));
        await ctrl.save();

        expect(fs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    it("round-trips an LF file byte-for-byte on save", async () => {
        const original = "line1\nline2\nline3\n";
        const filePath = writeFile("lf.txt", original);
        const ctrl = createEditorPane();

        ctrl.openFile(Uri.file(filePath));
        await ctrl.save();

        expect(fs.readFileSync(filePath, "utf-8")).toBe(original);
    });

    it("setEol marks the document modified and writes the new sequence on save", async () => {
        const filePath = writeFile("lf.txt", "a\nb\nc");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));
        expect(ctrl.isModified).toBe(false);

        ctrl.setEol(EndOfLine.CRLF);
        expect(ctrl.eol).toBe(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(true);

        await ctrl.save();
        expect(fs.readFileSync(filePath, "utf-8")).toBe("a\r\nb\r\nc");
        expect(ctrl.isModified).toBe(false);
    });

    it("setEol to the same sequence is a no-op (not modified)", () => {
        const filePath = writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));

        ctrl.setEol(EndOfLine.LF);

        expect(ctrl.isModified).toBe(false);
    });

    it("onDidChangeEol fires on setEol and on undo, surviving openFile re-creation", () => {
        const ctrl = createEditorPane();
        let fired = 0;
        ctrl.onDidChangeEol(() => fired++);

        // Подписка сделана до openFile — документ внутри пересоздаётся,
        // но слушатель контроллера должен продолжать работать.
        ctrl.openFile(Uri.file(writeFile("lf.txt", "a\nb")));

        ctrl.setEol(EndOfLine.CRLF);
        expect(fired).toBe(1);

        ctrl.undo();
        expect(fired).toBe(2);
    });

    it("dispose подписки onDidChangeEol останавливает доставку, повторный dispose — no-op", () => {
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(writeFile("lf.txt", "a\nb")));
        let fired = 0;
        const subscription = ctrl.onDidChangeEol(() => fired++);
        const other = ctrl.onDidChangeEol(() => undefined);

        subscription.dispose();
        subscription.dispose();
        ctrl.setEol(EndOfLine.CRLF);

        expect(fired).toBe(0);
        other.dispose();
    });

    it("undo of an eol change restores the eol and clears the modified flag", () => {
        const filePath = writeFile("lf.txt", "a\nb");
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));

        ctrl.setEol(EndOfLine.CRLF);
        expect(ctrl.isModified).toBe(true);

        ctrl.undo();

        expect(ctrl.eol).toBe(EndOfLine.LF);
        expect(ctrl.isModified).toBe(false);
    });
});
