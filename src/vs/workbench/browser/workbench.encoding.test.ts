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
        fs.writeFileSync(ws.path("cyr.txt"), iconv.encode("Привет, мир!\n", "windows1251"));
        ws.writeFile("plain.txt", "Ёлка\n");
        h = createAppTestHarness({ workspaceFolder: ws.dir });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("первый уровень: Reopen и Save для файла с диска", async () => {
        h.commands.execute("workbench.openFile", ws.path("plain.txt"));
        h.testApp.render();

        await changeEncoding(h);
        h.testApp.render();

        const labels = visiblePicker(h).items.map((item) => item.label);
        expect(labels).toEqual(["Reopen with Encoding", "Save with Encoding"]);
        h.testApp.sendKey("Escape");
    });

    it("в read-only остаётся только Reopen — писать нельзя", async () => {
        h.commands.execute("workbench.openFile", ws.path("plain.txt"));
        h.testApp.render();
        h.commands.execute("workbench.action.files.toggleActiveEditorReadonlyInSession");

        await changeEncoding(h);
        h.testApp.render();

        const labels = visiblePicker(h).items.map((item) => item.label);
        expect(labels).toEqual(["Reopen with Encoding"]);
        h.testApp.sendKey("Escape");
    });

    it("read-only безымянный буфер не открывает пикер вовсе", async () => {
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

    it("для безымянного буфера Reopen скрыт", async () => {
        h.commands.execute("workbench.action.files.newUntitledFile");
        h.testApp.render();

        await changeEncoding(h);
        h.testApp.render();

        const labels = visiblePicker(h).items.map((item) => item.label);
        expect(labels).toEqual(["Save with Encoding"]);
        h.testApp.sendKey("Escape");
    });

    it("Reopen with Encoding: cp1251-файл декодируется, статус-бар обновляется", async () => {
        h.commands.execute("workbench.openFile", ws.path("cyr.txt"));
        h.testApp.render();
        const editor = h.activeEditor();
        expect(editor.getText()).not.toContain("Привет");

        await changeEncoding(h);
        await pick(h, "Reopen");
        await pick(h, "Cyrillic (Windows 1251)");

        // Decoding windows-1251 waits for the iconv-lite lazy chunk, so wait by time, not by ticks.
        await vi.waitFor(() => {
            expect(editor.encoding).toBe("windows1251");
        });
        expect(editor.getText()).toBe("Привет, мир!\n");
        h.testApp.render();
        const items = statusTexts(h.container.get(StatusBarComponentDIToken).view);
        expect(items).toContain("Windows 1251");
    });

    it("Reopen на «грязном» буфере спрашивает подтверждение", async () => {
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
        expect(editor.getText()).toBe("Привет, мир!\n");
        expect(editor.isModified).toBe(false);
    });

    it("Save with Encoding: файл переписывается в выбранной кодировке", async () => {
        const filePath = ws.path("plain.txt");
        h.commands.execute("workbench.openFile", filePath);
        h.testApp.render();

        await changeEncoding(h);
        await pick(h, "Save with Encoding");
        await pick(h, "Cyrillic (Windows 1251)");

        await vi.waitFor(() => {
            expect([...fs.readFileSync(filePath)]).toEqual([...iconv.encode("Ёлка\n", "windows1251")]);
        });
        expect(h.activeEditor().encoding).toBe("windows1251");
    });

    it("без активного редактора команда — no-op (пикер не открывается)", async () => {
        h.commands.execute("workbench.action.editor.changeEncoding");
        await flushMicrotasks();
        h.testApp.render();

        const pickers = h.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[];
        expect(pickers.every((p) => p.items.length === 0)).toBe(true);
    });

    it("Save with Encoding у безымянного буфера уводит в Save As с выставленной кодировкой", async () => {
        h.commands.execute("workbench.action.files.newUntitledFile");
        h.testApp.render();
        h.activeEditor().viewState.type("Ёлка");

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
            expect([...fs.readFileSync(target)]).toEqual([...iconv.encode("Ёлка", "windows1251")]);
        });
    });

    it("Save with Encoding при внешнем изменении файла — Overwrite-диалог", async () => {
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
            expect([...fs.readFileSync(filePath)]).toEqual([...iconv.encode("Ёлка\n", "windows1251")]);
        });
    });

    it("Escape на любом уровне ничего не меняет", async () => {
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

    it("пикер меняет EOL и обновляет статус-бар", async () => {
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

    it("выбор LF возвращает EOL обратно", async () => {
        h.commands.execute("workbench.openFile", ws.path("a.txt"));
        h.testApp.render();
        h.activeEditor().setEol(EndOfLine.CRLF);

        h.commands.execute("workbench.action.editor.changeEOL");
        await flushMicrotasks();
        // The query "LF" matches both "LF" and "CRLF"; the first one (LF) becomes active.
        await pick(h, "LF");

        expect(h.activeEditor().eol).toBe(1); // EndOfLine.LF
    });

    it("Escape не меняет EOL", async () => {
        h.commands.execute("workbench.openFile", ws.path("a.txt"));
        h.testApp.render();

        h.commands.execute("workbench.action.editor.changeEOL");
        await flushMicrotasks();
        h.testApp.render();
        h.testApp.sendKey("Escape");
        await flushMicrotasks();

        expect(h.activeEditor().eol).toBe(1);
    });

    it("без активного редактора команда — no-op", async () => {
        h.commands.execute("workbench.action.editor.changeEOL");
        await flushMicrotasks();
        h.testApp.render();

        const pickers = h.testApp.querySelectorAll("QuickPickElement") as QuickPickElement[];
        expect(pickers.every((p) => p.items.length === 0)).toBe(true);
    });
});
