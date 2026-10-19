import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileService } from "../../../../platform/files/common/fileService.ts";
import { InMemoryFileSystemProvider } from "../../../../platform/files/common/inMemoryFileSystemProvider.ts";
import { QuickInputComponent } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";

import { SimpleFileDialog } from "./simpleFileDialog.ts";

const disposables = new DisposableStore();
afterEach(() => {
    disposables.clear();
});

const TREE: Record<string, string | null> = {
    "/home/u/notes.txt": "",
    "/ws/readme.md": "",
    "/ws/report.txt": "",
    "/ws/src/a.ts": "",
    "/ws/src/b.ts": "",
    "/ws/docs": null,
};

async function setup() {
    const files = disposables.add(new FileService());
    const provider = new InMemoryFileSystemProvider();
    disposables.add(files.registerProvider("file", provider));
    const ensureDir = async (dir: string): Promise<void> => {
        if (dir === "/" || (await files.exists(Uri.file(dir)))) return;
        await ensureDir(dir.substring(0, dir.lastIndexOf("/")) || "/");
        await files.createFolder(Uri.file(dir));
    };
    for (const [file, content] of Object.entries(TREE)) {
        if (content === null) {
            await ensureDir(file);
        } else {
            await ensureDir(file.substring(0, file.lastIndexOf("/")));
            await files.writeFile(Uri.file(file), new TextEncoder().encode(content));
        }
    }
    const component = new QuickInputComponent();
    const quickInput = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(100, 30));
    component.attachHost(body);
    const dialog = new SimpleFileDialog(quickInput, files, { userHome: "/home/u", defaultFolder: () => "/ws" });
    const view = (): Record<string, unknown> => component.view.inspectState();
    const type = (text: string): void => {
        for (const ch of text) testApp.sendKey(ch);
    };
    const settle = async (expected: Record<string, unknown>): Promise<void> => {
        await vi.waitFor(() => {
            expect(view()).toMatchObject(expected);
        });
    };
    return { files, dialog, component, testApp, view, type, settle };
}

describe("SimpleFileDialog — открытие", () => {
    it("показывает каталог по умолчанию: путь в строке, «..», каталоги раньше файлов, без подсветки", async () => {
        const { dialog, settle, component } = await setup();
        void dialog.showOpenDialog({ title: "Open File" });
        await settle({
            title: "Open File",
            query: "/ws/",
            items: ["..", "docs", "src", "readme.md", "report.txt"],
            activeIndex: -1,
        });
        expect(component.view.placeholder).toBe("Folder path");
    });

    it("стрелка дописывает имя строки выделенным — следующая буква его заменит", async () => {
        const { dialog, settle, testApp, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        testApp.sendKey("ArrowDown");
        // «..» не дописывается никогда.
        await settle({ query: "/ws/", activeIndex: 0 });
        testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/docs", activeIndex: 1 });
        expect(component.view.inputElement.inputState.selectedText).toBe("docs");
    });

    it("начало имени подсвечивает строку; Enter на каталоге — внутрь", async () => {
        const { dialog, settle, testApp, type } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("s");
        await settle({ query: "/ws/s", activeIndex: 2 });

        testApp.sendKey("Enter");
        await settle({ query: "/ws/src/", items: ["..", "a.ts", "b.ts"] });
        type("b");
        await settle({ query: "/ws/src/b", activeIndex: 2 });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/src/b.ts")]);
    });

    it("набранный путь целиком принимается, если файл есть", async () => {
        const { dialog, settle, testApp, type } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("readme.md");
        await settle({ query: "/ws/readme.md" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
    });

    it("несуществующий каталог с разделителем — подсказка эталона", async () => {
        const { dialog, settle, type, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("nope/");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe(
                "The path does not exist. Use ~ to go to your home directory.",
            );
        });
    });

    it("несуществующий файл — Enter не закрывает, а просит существующий путь", async () => {
        const { dialog, settle, testApp, type, component } = await setup();
        const result = dialog.showOpenDialog();
        let settled = false;
        void result.then(() => (settled = true));
        await settle({ query: "/ws/" });
        type("zzz.txt");
        await settle({ query: "/ws/zzz.txt" });
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please enter a path that exists.");
        });
        expect(settled).toBe(false);
        expect(component.isOpen()).toBe(true);
    });

    it("только папки: Enter на пути к каталогу без подсветки — этот каталог", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
        await settle({ query: "/ws/", items: ["..", "docs", "src"] });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws")]);
    });

    it("файл, когда просили папку, — «Please select a folder.»", async () => {
        const { dialog, settle, testApp, type, component } = await setup();
        void dialog.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
        await settle({ query: "/ws/" });
        type("readme.md");
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please select a folder.");
        });
    });

    it("«~/» уводит в домашний каталог", async () => {
        const { dialog, settle, type, testApp } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        for (const key of Array.from("/ws/", () => "Backspace")) testApp.sendKey(key);
        type("~/");
        await settle({ query: "/home/u/", items: ["..", "notes.txt"] });
    });

    it("«..» и Enter — на уровень вверх", async () => {
        const { dialog, settle, testApp } = await setup();
        void dialog.showOpenDialog({ defaultUri: Uri.file("/ws/src") });
        await settle({ query: "/ws/src/", items: ["..", "a.ts", "b.ts"] });
        testApp.sendKey("ArrowDown");
        await settle({ activeIndex: 0 });
        testApp.sendKey("Enter");
        await settle({ query: "/ws/", items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("фильтры прячут чужие файлы", async () => {
        const { dialog, settle } = await setup();
        void dialog.showOpenDialog({ filters: [{ name: "Markdown", extensions: ["md"] }] });
        await settle({ items: ["..", "docs", "src", "readme.md"] });
    });

    it("Escape — undefined", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });
});

describe("SimpleFileDialog — сохранение", () => {
    it("имя из defaultUri стоит в строке, курсор перед расширением; Enter — этот путь", async () => {
        const { dialog, settle, testApp, component } = await setup();
        const result = dialog.showSaveDialog({ defaultUri: Uri.file("/ws/new.txt"), title: "Save As" });
        await settle({ query: "/ws/new.txt", title: "Save As" });
        // Имя без расширения выделено: набор заменит его, «.txt» останется.
        expect(component.view.inputElement.inputState.cursorOffset).toBe("/ws/new".length);
        expect(component.view.inputElement.inputState.selectedText).toBe("new");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/new.txt"));
    });

    it("существующий файл — вопрос о перезаписи: Enter — да", async () => {
        const { dialog, settle, testApp, view } = await setup();
        const result = dialog.showSaveDialog({ defaultUri: Uri.file("/ws/report.txt") });
        await settle({ query: "/ws/report.txt" });
        testApp.sendKey("Enter");
        await settle({ title: "report.txt already exists. Are you sure you want to overwrite it?" });
        expect(view()).toMatchObject({ items: [] });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/report.txt"));
    });

    it("отказ от перезаписи (Escape) возвращает в диалог", async () => {
        const { dialog, settle, testApp } = await setup();
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/report.txt") });
        await settle({ query: "/ws/report.txt" });
        testApp.sendKey("Enter");
        await settle({ title: "report.txt already exists. Are you sure you want to overwrite it?" });
        testApp.sendKey("Escape");
        await settle({ query: "/ws/report.txt", items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("с фильтрами недостающее расширение дописывается", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showSaveDialog({
            defaultUri: Uri.file("/ws/notes"),
            filters: [{ name: "Text", extensions: ["txt"] }],
        });
        await settle({ query: "/ws/notes" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/notes.txt"));
    });

    it("каталог вместо имени — просьба дать новое имя файла", async () => {
        const { dialog, settle, testApp, component } = await setup();
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/docs") });
        await settle({ query: "/ws/docs/" });
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("The folder already exists. Please use a new file name.");
        });
    });
});
