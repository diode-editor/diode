import * as fs from "node:fs";

import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { fileDialogDriver } from "../../../TestUtils/fileDialogDriver.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";
import { EndOfLine } from "../../editor/common/core/endOfLine.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";

import type { QuickPickElement } from "./parts/quickinput/quickPickElement.ts";
import { statusTexts } from "./parts/statusbar/statusBarComponent.testUtils.ts";
import { StatusBarComponentDIToken } from "./parts/statusbar/statusBarComponent.ts";

function visiblePicker(h: IAppHarness): QuickPickElement {
    // Quick open holds its own QuickPickElement; we need the one with items.
    const pickers = h.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[];
    const picker = pickers.find((p) => p.items.length > 0);
    if (picker === undefined) throw new Error("Quick pick with items not found");
    return picker;
}

/** "Reopen" availability is checked against disk asynchronously, so wait for the picker's first level. */
async function changeEncoding(h: IAppHarness): Promise<void> {
    h.commands.execute("workbench.action.editor.changeEncoding");
    await vi.waitFor(() => {
        h.testApp.render();
        visiblePicker(h);
    });
}

async function pick(h: IAppHarness, query: string): Promise<void> {
    h.testApp.render();
    const picker = visiblePicker(h);
    picker.setQuery(query);
    // setQuery does not fire the callback: filtering is triggered by QuickInputService
    // via onQueryChange (as with live typing).
    picker.onQueryChange?.(query);
    h.testApp.sendKey("Enter");
    await flushMicrotasks();
    h.testApp.render();
}

describe("Workbench — Change File Encoding", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-encoding-" });
        fs.writeFileSync(
            ws.path("cyr.txt"),
            iconv.encode("\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n", "windows1251"),
        ); // "Privet, mir!"
        ws.writeFile("plain.txt", "\u0401\u043b\u043a\u0430\n"); // "Yolka"
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("first level: Reopen and Save for a file on disk", async () => {
        h.commands.execute("workbench.openFile", ws.path("plain.txt"));
        h.testApp.render();

        await changeEncoding(h);
        h.testApp.render();

        const labels = visiblePicker(h).items.map((item) => item.label);
        expect(labels).toEqual(["Reopen with Encoding", "Save with Encoding"]);
        h.testApp.sendKey("Escape");
    });

    it("read-only keeps only Reopen — writing is not allowed", async () => {
        h.commands.execute("workbench.openFile", ws.path("plain.txt"));
        h.testApp.render();
        h.commands.execute("workbench.action.files.toggleActiveEditorReadonlyInSession");

        await changeEncoding(h);
        h.testApp.render();

        const labels = visiblePicker(h).items.map((item) => item.label);
        expect(labels).toEqual(["Reopen with Encoding"]);
        h.testApp.sendKey("Escape");
    });

    it("a read-only untitled buffer does not open the picker at all", async () => {
        // Neither reread nor write: an empty list would be a dead end.
        h.commands.execute("workbench.action.files.newUntitledFile");
        h.testApp.render();
        h.commands.execute("workbench.action.files.toggleActiveEditorReadonlyInSession");

        h.commands.execute("workbench.action.editor.changeEncoding");
        await flushMicrotasks();
        h.testApp.render();

        const pickers = h.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[];
        expect(pickers.every((picker) => picker.items.length === 0)).toBe(true);
    });

    it("Reopen is hidden for an untitled buffer", async () => {
        h.commands.execute("workbench.action.files.newUntitledFile");
        h.testApp.render();

        await changeEncoding(h);
        h.testApp.render();

        const labels = visiblePicker(h).items.map((item) => item.label);
        expect(labels).toEqual(["Save with Encoding"]);
        h.testApp.sendKey("Escape");
    });

    it("Reopen with Encoding: a cp1251 file is decoded, the status bar updates", async () => {
        h.commands.execute("workbench.openFile", ws.path("cyr.txt"));
        h.testApp.render();
        const editor = h.activeEditor();
        expect(editor.getText()).not.toContain("\u041f\u0440\u0438\u0432\u0435\u0442"); // "Privet"

        await changeEncoding(h);
        await pick(h, "Reopen");
        await pick(h, "Cyrillic (Windows 1251)");

        // Decoding windows-1251 waits for the iconv-lite lazy chunk, so wait by time, not by ticks.
        await vi.waitFor(() => {
            expect(editor.encoding).toBe("windows1251");
        });
        expect(editor.getText()).toBe("\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n"); // "Privet, mir!"
        h.testApp.render();
        const items = statusTexts(h.container.get(StatusBarComponentDIToken).view);
        expect(items).toContain("Windows 1251");
    });

    it("Reopen on a dirty buffer asks for confirmation", async () => {
        h.commands.execute("workbench.openFile", ws.path("cyr.txt"));
        h.testApp.render();
        const editor = h.activeEditor();
        editor.viewState.type("x");
        expect(editor.isModified).toBe(true);

        await changeEncoding(h);
        await pick(h, "Reopen");
        await pick(h, "Cyrillic (Windows 1251)");

        expect(editor.encoding).toBe("utf8");
        const dialog = h.container.get(DialogServiceDIToken).getOpenConfirmDialog();
        expect(dialog).not.toBeNull();

        dialog!.onConfirm?.();
        await vi.waitFor(() => {
            expect(editor.encoding).toBe("windows1251");
        });
        expect(editor.getText()).toBe("\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n"); // "Privet, mir!"
        expect(editor.isModified).toBe(false);
    });

    it("Save with Encoding: the file is rewritten in the chosen encoding", async () => {
        const filePath = ws.path("plain.txt");
        h.commands.execute("workbench.openFile", filePath);
        h.testApp.render();

        await changeEncoding(h);
        await pick(h, "Save with Encoding");
        await pick(h, "Cyrillic (Windows 1251)");

        await vi.waitFor(() => {
            expect([...fs.readFileSync(filePath)]).toEqual([
                ...iconv.encode("\u0401\u043b\u043a\u0430\n", "windows1251"),
            ]); // "Yolka"
        });
        expect(h.activeEditor().encoding).toBe("windows1251");
    });

    it("without an active editor the command is a no-op (the picker does not open)", async () => {
        h.commands.execute("workbench.action.editor.changeEncoding");
        await flushMicrotasks();
        h.testApp.render();

        const pickers = h.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[];
        expect(pickers.every((p) => p.items.length === 0)).toBe(true);
    });

    it("Save with Encoding on an untitled buffer goes to Save As with the encoding set", async () => {
        h.commands.execute("workbench.action.files.newUntitledFile");
        h.testApp.render();
        h.activeEditor().viewState.type("\u0401\u043b\u043a\u0430"); // "Yolka"

        await changeEncoding(h);
        await pick(h, "Save with Encoding");
        await pick(h, "Cyrillic (Windows 1251)");

        expect(h.activeEditor().encoding).toBe("windows1251");
        const dialog = fileDialogDriver(h);
        await dialog.settle({ title: "Save As" });

        const target = ws.path("untitled-out.txt");
        dialog.replaceQuery(target);
        await dialog.settle({ query: target });
        dialog.key("Enter");
        await vi.waitFor(() => {
            expect([...fs.readFileSync(target)]).toEqual([...iconv.encode("\u0401\u043b\u043a\u0430", "windows1251")]); // "Yolka"
        });
    });

    it("Save with Encoding after an external file change — Overwrite dialog", async () => {
        const filePath = ws.path("plain.txt");
        h.commands.execute("workbench.openFile", filePath);
        h.testApp.render();
        fs.writeFileSync(filePath, "external edit that changes size\n", "utf-8");

        await changeEncoding(h);
        await pick(h, "Save with Encoding");
        await pick(h, "Cyrillic (Windows 1251)");

        expect(fs.readFileSync(filePath, "utf-8")).toBe("external edit that changes size\n");
        const dialog = h.container.get(DialogServiceDIToken).getOpenConfirmDialog();
        expect(dialog).not.toBeNull();

        dialog!.onConfirm?.();
        await vi.waitFor(() => {
            expect([...fs.readFileSync(filePath)]).toEqual([
                ...iconv.encode("\u0401\u043b\u043a\u0430\n", "windows1251"),
            ]); // "Yolka"
        });
    });

    it("Escape at any level changes nothing", async () => {
        const filePath = ws.path("plain.txt");
        const before = [...fs.readFileSync(filePath)];
        h.commands.execute("workbench.openFile", filePath);
        h.testApp.render();

        await changeEncoding(h);
        await pick(h, "Save with Encoding");
        h.testApp.sendKey("Escape");
        await flushMicrotasks();

        expect([...fs.readFileSync(filePath)]).toEqual(before);
        expect(h.activeEditor().encoding).toBe("utf8");
    });
});

describe("Workbench — Change End of Line Sequence", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-changeeol-", files: { "a.txt": "one\ntwo\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("the picker changes EOL and updates the status bar", async () => {
        h.commands.execute("workbench.openFile", ws.path("a.txt"));
        h.testApp.render();

        h.commands.execute("workbench.action.editor.changeEOL");
        await flushMicrotasks();
        await pick(h, "CRLF");

        const editor = h.activeEditor();
        expect(editor.eol).toBe(2); // EndOfLine.CRLF
        const items = statusTexts(h.container.get(StatusBarComponentDIToken).view);
        expect(items).toContain("CRLF");
    });

    it("choosing LF switches EOL back", async () => {
        h.commands.execute("workbench.openFile", ws.path("a.txt"));
        h.testApp.render();
        h.activeEditor().setEol(EndOfLine.CRLF);

        h.commands.execute("workbench.action.editor.changeEOL");
        await flushMicrotasks();
        // The query "LF" matches both "LF" and "CRLF"; the first one (LF) becomes active.
        await pick(h, "LF");

        expect(h.activeEditor().eol).toBe(1); // EndOfLine.LF
    });

    it("Escape does not change EOL", async () => {
        h.commands.execute("workbench.openFile", ws.path("a.txt"));
        h.testApp.render();

        h.commands.execute("workbench.action.editor.changeEOL");
        await flushMicrotasks();
        h.testApp.render();
        h.testApp.sendKey("Escape");
        await flushMicrotasks();

        expect(h.activeEditor().eol).toBe(1);
    });

    it("without an active editor the command is a no-op", async () => {
        h.commands.execute("workbench.action.editor.changeEOL");
        await flushMicrotasks();
        h.testApp.render();

        const pickers = h.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[];
        expect(pickers.every((p) => p.items.length === 0)).toBe(true);
    });
});
