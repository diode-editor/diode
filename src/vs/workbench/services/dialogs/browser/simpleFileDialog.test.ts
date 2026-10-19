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

async function setup(defaultFolder = "/ws") {
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
    const dialog = new SimpleFileDialog(quickInput, files, { userHome: "/home/u", defaultFolder: () => defaultFolder });
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
        expect(component.isOpen()).toBe(true);
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
        const { dialog, settle, testApp, view, component } = await setup();
        const result = dialog.showSaveDialog({ defaultUri: Uri.file("/ws/report.txt") });
        await settle({ query: "/ws/report.txt" });
        testApp.sendKey("Enter");
        await settle({ title: "report.txt already exists. Are you sure you want to overwrite it?" });
        expect(view()).toMatchObject({ items: [] });
        expect(component.view.inputElement.inputState.cursorOffset).toBe("/ws/report.txt".length);
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
        expect(component.isOpen()).toBe(true);
    });
});

describe("SimpleFileDialog — набор пути", () => {
    it("Backspace в имя каталога — список родителя, буква дальше подсвечивает каталог", async () => {
        const { dialog, settle, testApp, type } = await setup();
        void dialog.showOpenDialog({ defaultUri: Uri.file("/ws/src") });
        await settle({ query: "/ws/src/", items: ["..", "a.ts", "b.ts"] });
        // Разделитель на конце каталог не меняет: пути сравниваются без него.
        testApp.sendKey("Backspace");
        await settle({ query: "/ws/src", items: ["..", "a.ts", "b.ts"] });
        testApp.sendKey("Backspace");
        await settle({ query: "/ws/sr", items: ["..", "docs", "src", "readme.md", "report.txt"], activeIndex: -1 });
        // Подсветку, как у эталона, ставит следующая буква.
        type("c");
        await settle({ query: "/ws/src", activeIndex: 2 });
    });

    it("«..» — сразу на уровень вверх, без разделителя", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showOpenDialog({ defaultUri: Uri.file("/ws/src") });
        await settle({ query: "/ws/src/" });
        // «.» сам по себе каталог не меняет.
        type(".");
        await settle({ query: "/ws/src/.", items: ["..", "a.ts", "b.ts"] });
        type(".");
        await settle({ query: "/ws/", items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("после несуществующего каталога «~» в конце уводит домой", async () => {
        const { dialog, settle, type, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("nope/");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe(
                "The path does not exist. Use ~ to go to your home directory.",
            );
        });
        type("x");
        await settle({ query: "/ws/nope/x" });
        type("~");
        await settle({ query: "/home/u/", items: ["..", "notes.txt"] });
        expect(component.view.validationMessage).toBeNull();
    });

    it("подсказка о плохом пути уходит, когда набранное снова ведёт в существующий каталог", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("nope/");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).not.toBeNull();
        });
        for (const key of Array.from("nope/", () => "Backspace")) testApp.sendKey(key);
        type("src/");
        await settle({ query: "/ws/src/", items: ["..", "a.ts", "b.ts"] });
        expect(component.view.validationMessage).toBeNull();
    });

    it("набранное не совпадает ни с одной строкой — подсветки нет, Enter берёт набранное", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("s");
        await settle({ activeIndex: 2 });
        type("q");
        await settle({ query: "/ws/sq", activeIndex: -1 });
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please enter a path that exists.");
        });
    });

    it("регистр набранного не мешает подсветке", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("RE");
        await settle({ query: "/ws/RE", activeIndex: 3 });
    });

    it("стрелка после набора дописывает выбранное имя целиком, на «..» дописывать нечего", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("r");
        await settle({ activeIndex: 3 });
        testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/report.txt", activeIndex: 4 });
        expect(component.view.inputElement.inputState.selectedText).toBe("report.txt");
        testApp.sendKey("ArrowUp");
        await settle({ query: "/ws/readme.md", activeIndex: 3 });
        for (let i = 0; i < 3; i++) testApp.sendKey("ArrowUp");
        await settle({ activeIndex: 0 });
        expect(component.view.inputElement.inputState.selectedText).toBe("");
    });

    it("стрелкой выбранный файл и Enter — этот файл", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        for (let i = 0; i < 4; i++) testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/readme.md", activeIndex: 3 });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
    });

    it("стрелкой выбранный каталог и Enter — внутрь", async () => {
        const { dialog, settle, testApp, type } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        for (let i = 0; i < 3; i++) testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/src", activeIndex: 2 });
        testApp.sendKey("Enter");
        await settle({ query: "/ws/src/", items: ["..", "a.ts", "b.ts"] });
        // Подгрузка дошла до конца — набор дальше снова подсвечивает.
        type("b");
        await settle({ query: "/ws/src/b", activeIndex: 2 });
        // Вход в каталог принятием не был — следующий Enter принимает файл.
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/src/b.ts")]);
    });
});

describe("SimpleFileDialog — начальный каталог и режимы", () => {
    it("defaultUri на файл: имя в строке, курсор в конце; Enter — этот файл", async () => {
        const { dialog, settle, testApp, component } = await setup();
        const result = dialog.showOpenDialog({ defaultUri: Uri.file("/ws/readme.md") });
        await settle({ query: "/ws/readme.md", items: ["..", "docs", "src", "readme.md", "report.txt"] });
        expect(component.view.inputElement.inputState.cursorOffset).toBe("/ws/readme.md".length);
        expect(component.view.inputElement.inputState.selectedText).toBe("");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
    });

    it("каталога по умолчанию нет — строка с ним, а в списке только «..»", async () => {
        const { dialog, settle } = await setup("/ws/gone");
        void dialog.showOpenDialog();
        await settle({ query: "/ws/gone/", items: [".."] });
    });

    it("в корне ФС «..» нет", async () => {
        const { dialog, settle } = await setup("/");
        void dialog.showOpenDialog();
        await settle({ query: "/", items: ["home", "ws"] });
    });

    it("файлы и папки вместе: файлы видны, Enter на набранном каталоге — он сам", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showOpenDialog({ canSelectFiles: true, canSelectFolders: true });
        await settle({ query: "/ws/", items: ["..", "docs", "src", "readme.md", "report.txt"] });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws")]);
    });

    it("только файлы: Enter на каталоге без подсветки — «Please select a file.»", async () => {
        const { dialog, settle, testApp, component } = await setup();
        void dialog.showOpenDialog({ canSelectFiles: true });
        await settle({ query: "/ws/" });
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please select a file.");
        });
        expect(component.isOpen()).toBe(true);
    });
});

describe("SimpleFileDialog — проверки при сохранении", () => {
    it("без defaultUri — каталог по умолчанию, курсор в конце; набранное имя сохраняется", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        const result = dialog.showSaveDialog();
        await settle({ query: "/ws/", items: ["..", "docs", "src", "readme.md", "report.txt"] });
        expect(component.view.inputElement.inputState.cursorOffset).toBe("/ws/".length);
        type("fresh.md");
        await settle({ query: "/ws/fresh.md" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/fresh.md"));
    });

    it("недопустимое имя — «Please enter a valid file name.»", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showSaveDialog();
        await settle({ query: "/ws/" });
        type("x".repeat(256));
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please enter a valid file name.");
        });
        expect(component.isOpen()).toBe(true);
    });

    it("каталога нет — вопрос: Enter создаёт его и сохраняет", async () => {
        const { dialog, settle, testApp, files } = await setup();
        const result = dialog.showSaveDialog({ defaultUri: Uri.file("/ws/newdir/a.txt") });
        await settle({ query: "/ws/newdir/a.txt" });
        testApp.sendKey("Enter");
        await settle({
            title: "The folder newdir does not exist. Would you like to create it?",
            query: "/ws/newdir/a.txt",
        });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/newdir/a.txt"));
        await expect(files.exists(Uri.file("/ws/newdir"))).resolves.toBe(true);
    });

    it("каталога нет, от создания отказались — диалог остаётся, каталог не создан", async () => {
        const { dialog, settle, testApp, files, component } = await setup();
        let settled = false;
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/newdir/a.txt") }).then(() => (settled = true));
        await settle({ query: "/ws/newdir/a.txt" });
        testApp.sendKey("Enter");
        await settle({ title: "The folder newdir does not exist. Would you like to create it?" });
        testApp.sendKey("Escape");
        await settle({ query: "/ws/newdir/a.txt" });
        expect(component.isOpen()).toBe(true);
        expect(settled).toBe(false);
        await expect(files.exists(Uri.file("/ws/newdir"))).resolves.toBe(false);
    });

    it("в вопросе набор — это «нет»: вопрос закрывается, диалог возвращается", async () => {
        const { dialog, settle, testApp, type } = await setup();
        let settled = false;
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/report.txt") }).then(() => (settled = true));
        await settle({ query: "/ws/report.txt" });
        testApp.sendKey("Enter");
        await settle({ title: "report.txt already exists. Are you sure you want to overwrite it?" });
        type("x");
        await settle({ query: "/ws/report.txt", items: ["..", "docs", "src", "readme.md", "report.txt"] });
        expect(settled).toBe(false);
    });

    it("после отказа от перезаписи Enter снова спрашивает", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showSaveDialog({ defaultUri: Uri.file("/ws/report.txt") });
        await settle({ query: "/ws/report.txt" });
        testApp.sendKey("Enter");
        await settle({ title: "report.txt already exists. Are you sure you want to overwrite it?" });
        testApp.sendKey("Escape");
        await settle({ query: "/ws/report.txt", title: undefined });
        testApp.sendKey("Enter");
        await settle({ title: "report.txt already exists. Are you sure you want to overwrite it?" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/report.txt"));
    });

    it("вместо каталога — файл: «Please enter a path that exists.»", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showSaveDialog();
        await settle({ query: "/ws/" });
        type("readme.md/x.txt");
        await settle({ query: "/ws/readme.md/x.txt" });
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please enter a path that exists.");
        });
        expect(component.isOpen()).toBe(true);
    });

    it("каталог создать не вышло — диалог возвращается с причиной", async () => {
        const { dialog, settle, testApp, files, component } = await setup();
        vi.spyOn(files, "createFolder").mockRejectedValueOnce(new Error("denied"));
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/newdir/a.txt") });
        await settle({ query: "/ws/newdir/a.txt" });
        testApp.sendKey("Enter");
        await settle({ title: "The folder newdir does not exist. Would you like to create it?" });
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Could not create folder: denied");
        });
        expect(component.isOpen()).toBe(true);
    });

    it("Enter на каталоге при сохранении входит в него, имя файла остаётся, курсор перед ним", async () => {
        const { dialog, settle, testApp, component } = await setup();
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/new.txt") });
        await settle({ query: "/ws/new.txt" });
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        await settle({ activeIndex: 1 });
        testApp.sendKey("Enter");
        await settle({ query: "/ws/docs/new.txt", items: [".."] });
        await vi.waitFor(() => {
            expect(component.view.inputElement.inputState.cursorOffset).toBe("/ws/docs/".length);
        });
    });

    it("Escape в диалоге — undefined", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showSaveDialog();
        await settle({ query: "/ws/" });
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });
});

describe("SimpleFileDialog — только папки: создание", () => {
    it("несуществующая папка в существующем каталоге — вопрос; Enter создаёт и выбирает её", async () => {
        const { dialog, settle, type, testApp, files } = await setup();
        const result = dialog.showOpenDialog({ canSelectFolders: true });
        await settle({ query: "/ws/" });
        type("fresh");
        await settle({ query: "/ws/fresh" });
        testApp.sendKey("Enter");
        await settle({ title: "The folder fresh does not exist. Would you like to create it?" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/fresh")]);
        await expect(files.exists(Uri.file("/ws/fresh"))).resolves.toBe(true);
    });

    it("от создания отказались — папки нет, диалог открыт", async () => {
        const { dialog, settle, type, testApp, files, component } = await setup();
        void dialog.showOpenDialog({ canSelectFolders: true });
        await settle({ query: "/ws/" });
        type("fresh");
        testApp.sendKey("Enter");
        await settle({ title: "The folder fresh does not exist. Would you like to create it?" });
        testApp.sendKey("Escape");
        await settle({ query: "/ws/fresh" });
        expect(component.isOpen()).toBe(true);
        await expect(files.exists(Uri.file("/ws/fresh"))).resolves.toBe(false);
    });

    it("создать не вышло — сообщение с причиной", async () => {
        const { dialog, settle, type, testApp, files, component } = await setup();
        vi.spyOn(files, "createFolder").mockRejectedValueOnce(new Error("denied"));
        void dialog.showOpenDialog({ canSelectFolders: true });
        await settle({ query: "/ws/" });
        type("fresh");
        testApp.sendKey("Enter");
        await settle({ title: "The folder fresh does not exist. Would you like to create it?" });
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Could not create folder: denied");
        });
        expect(component.isOpen()).toBe(true);
    });

    it("не Error в отказе ФС — строкой", async () => {
        const { dialog, settle, type, testApp, files, component } = await setup();
        vi.spyOn(files, "createFolder").mockRejectedValueOnce("busy");
        void dialog.showOpenDialog({ canSelectFolders: true });
        await settle({ query: "/ws/" });
        type("fresh");
        testApp.sendKey("Enter");
        await settle({ title: "The folder fresh does not exist. Would you like to create it?" });
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Could not create folder: busy");
        });
    });

    it("родителя нет — создавать не предлагает", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog({ canSelectFolders: true });
        await settle({ query: "/ws/" });
        type("nope/deeper");
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please enter a path that exists.");
        });
    });

    it("файлы и папки: несуществующее — без вопроса, просьба о существующем пути", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog({ canSelectFolders: true, canSelectFiles: true });
        await settle({ query: "/ws/" });
        type("fresh");
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please enter a path that exists.");
        });
    });
});

describe("SimpleFileDialog — ход принятия", () => {
    it("стрелка снимает сообщение проверки", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("zzz");
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please enter a path that exists.");
        });
        testApp.sendKey("ArrowDown");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBeNull();
        });
    });

    it("принятый ответ закрывает диалог", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("readme.md");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
        expect(component.isOpen()).toBe(false);
    });

    it("пробелы в конце набранного пути не мешают", async () => {
        const { dialog, settle, type, testApp } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("readme.md  ");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
    });

    it("Escape, пока идёт неудачная проверка, — ответ undefined", async () => {
        const { dialog, settle, type, testApp, files } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("zzz");
        await settle({ query: "/ws/zzz" });
        let release = (): void => undefined;
        const stat = files.stat.bind(files);
        vi.spyOn(files, "stat").mockImplementation(
            (resource) =>
                new Promise((done) => {
                    release = () => {
                        done(stat(resource));
                    };
                }),
        );
        testApp.sendKey("Enter");
        testApp.sendKey("Escape");
        vi.mocked(files.stat).mockRestore();
        release();
        await expect(result).resolves.toBeUndefined();
    });

    it("второй Enter, пока идёт первый, ничего не добавляет", async () => {
        const { dialog, settle, testApp, component } = await setup();
        const result = dialog.showSaveDialog({ defaultUri: Uri.file("/ws/report.txt") });
        await settle({ query: "/ws/report.txt" });
        testApp.sendKey("Enter");
        testApp.sendKey("Enter");
        await settle({ title: "report.txt already exists. Are you sure you want to overwrite it?" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/report.txt"));
        await Promise.resolve();
        expect(component.isOpen()).toBe(false);
    });

    it("отказ от перезаписи, затем Escape в диалоге — undefined", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showSaveDialog({ defaultUri: Uri.file("/ws/report.txt") });
        await settle({ query: "/ws/report.txt" });
        testApp.sendKey("Enter");
        await settle({ title: "report.txt already exists. Are you sure you want to overwrite it?" });
        testApp.sendKey("Escape");
        await settle({ title: undefined, query: "/ws/report.txt" });
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });

    it("стёрто дополненное — подсветка снята, следующая буква подсвечивает", async () => {
        const { dialog, settle, type, testApp } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/docs", activeIndex: 1 });
        // Выделенный хвост «docs» стирается одним Backspace.
        testApp.sendKey("Backspace");
        await settle({ query: "/ws/", activeIndex: -1 });
        type("s");
        await settle({ query: "/ws/s", activeIndex: 2 });
    });

    it("плохой путь: дальнейший набор подсказку не снимает, повтор разделителя её возвращает", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("nope/");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).not.toBeNull();
        });
        type("x");
        await settle({ query: "/ws/nope/x" });
        expect(component.view.validationMessage).toBe("The path does not exist. Use ~ to go to your home directory.");
        testApp.sendKey("Backspace");
        testApp.sendKey("Backspace");
        await settle({ query: "/ws/nope" });
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBeNull();
        });
        type("/");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe(
                "The path does not exist. Use ~ to go to your home directory.",
            );
        });
    });

    it("каталог по умолчанию — файл: его каталог, имя в строке", async () => {
        const { dialog, settle } = await setup("/ws/readme.md");
        void dialog.showOpenDialog();
        await settle({ query: "/ws/readme.md", items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("стрелка на «..» после автодополнения — курсор в конец, выделения нет", async () => {
        const { dialog, settle, testApp, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/docs", activeIndex: 1 });
        testApp.sendKey("ArrowUp");
        await settle({ activeIndex: 0 });
        expect(component.view.inputElement.inputState.selectedText).toBe("");
        expect(component.view.inputElement.inputState.cursorOffset).toBe(component.view.getQuery().length);
    });
});

/**
 * Придерживает подгрузку каталога `folder`: `started` — она началась и ждёт,
 * `release` — отпустить.
 */
function holdFolder(files: FileService, folder: string): { started: () => Promise<void>; release: () => void } {
    const resolve = files.resolve.bind(files);
    let release = (): void => undefined;
    const held = new Promise<void>((done) => {
        release = done;
    });
    let reached = false;
    vi.spyOn(files, "resolve").mockImplementation(async (resource) => {
        if (resource.fsPath === folder) {
            reached = true;
            await held;
        }
        return resolve(resource);
    });
    const started = (): Promise<void> =>
        vi.waitFor(() => {
            expect(reached).toBe(true);
        });
    return {
        started,
        release: () => {
            release();
        },
    };
}

describe("SimpleFileDialog — во время подгрузки каталога", () => {
    it("Enter ждёт подгрузку и судит уже по новому каталогу", async () => {
        const { dialog, settle, type, testApp, files, component } = await setup();
        void dialog.showOpenDialog({ canSelectFiles: true });
        await settle({ query: "/ws/" });
        const { started, release } = holdFolder(files, "/ws/src");
        type("src/");
        await started();
        testApp.sendKey("Enter");
        await settle({ query: "/ws/src/", items: ["..", "docs", "src", "readme.md", "report.txt"] });
        release();
        await settle({ items: ["..", "a.ts", "b.ts"] });
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please select a file.");
        });
    });

    it("допечатанное поверх подгрузки остаётся в строке", async () => {
        const { dialog, settle, type, files } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        const { release } = holdFolder(files, "/ws/src");
        type("src/a");
        release();
        await settle({ query: "/ws/src/a", items: ["..", "a.ts", "b.ts"] });
    });

    it("строки прежнего каталога не подсвечиваются, пока грузится новый", async () => {
        const { dialog, settle, type, testApp, files, view } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        const { started, release } = holdFolder(files, "/ws/src");
        type("src/");
        await started();
        testApp.sendKey("Backspace");
        await settle({ query: "/ws/src" });
        await new Promise((done) => setTimeout(done, 50));
        expect(view()).toMatchObject({ activeIndex: -1 });
        // Подгрузка без force набранное не трогает: в строке остаётся «/ws/src».
        release();
        await settle({ items: ["..", "a.ts", "b.ts"] });
        expect(view()).toMatchObject({ query: "/ws/src" });
    });

    it("ответ устаревшей подгрузки не перебивает свежую", async () => {
        const { dialog, settle, type, testApp, files, view } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        const { started, release } = holdFolder(files, "/ws/src");
        type("src/");
        await started();
        for (const key of Array.from("src/", () => "Backspace")) testApp.sendKey(key);
        type("docs/");
        await settle({ query: "/ws/docs/", items: [".."] });
        release();
        await new Promise((done) => setTimeout(done, 50));
        expect(view()).toMatchObject({ query: "/ws/docs/", items: [".."] });
    });
});

/** Придерживает stat пути `target`: `started` — он начался и ждёт, `release` — отпустить. */
function holdStat(files: FileService, target: string): { started: () => Promise<void>; release: () => void } {
    const stat = files.stat.bind(files);
    let release = (): void => undefined;
    const held = new Promise<void>((done) => {
        release = done;
    });
    let reached = false;
    vi.spyOn(files, "stat").mockImplementation(async (resource) => {
        if (resource.fsPath === target) {
            reached = true;
            await held;
        }
        return stat(resource);
    });
    const started = (): Promise<void> =>
        vi.waitFor(() => {
            expect(reached).toBe(true);
        });
    return {
        started,
        release: () => {
            release();
        },
    };
}

describe("SimpleFileDialog — набор: края", () => {
    it("в корне без подгрузок набор сразу подсвечивает, а стёртое до корня — нет", async () => {
        const { dialog, settle, type, testApp } = await setup("/");
        void dialog.showOpenDialog();
        await settle({ query: "/", items: ["home", "ws"] });
        type("w");
        await settle({ query: "/w", activeIndex: 1 });
        testApp.sendKey("Backspace");
        await settle({ query: "/", activeIndex: -1 });
    });

    it("«.» не подсвечивает «..»", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type(".");
        await settle({ query: "/ws/." });
        await new Promise((done) => setTimeout(done, 30));
        await settle({ activeIndex: -1 });
    });

    it("«~» не в начале и не после плохого пути — просто буква", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("a~");
        await settle({ query: "/ws/a~" });
        await new Promise((done) => setTimeout(done, 30));
        await settle({ items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("сохранение: стрелкой выбранный файл остаётся подсвеченным, Enter — вопрос о нём", async () => {
        const { dialog, settle, testApp } = await setup();
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/new.txt") });
        await settle({ query: "/ws/new.txt" });
        for (let step = 0; step < 4; step++) testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/readme.md", activeIndex: 3 });
        await new Promise((done) => setTimeout(done, 30));
        await settle({ activeIndex: 3 });
        testApp.sendKey("Enter");
        await settle({ title: "readme.md already exists. Are you sure you want to overwrite it?" });
    });

    it("сохранение с именем: набор начала имени чужого файла его не подсвечивает", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/x") });
        await settle({ query: "/ws/x" });
        // Имя выделено — буква его заменяет.
        type("r");
        await settle({ query: "/ws/r" });
        await new Promise((done) => setTimeout(done, 30));
        await settle({ activeIndex: -1 });
    });

    it("сохранение: набранное имя с расширением переезжает в каталог", async () => {
        const { dialog, settle, type, testApp } = await setup();
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/x") });
        await settle({ query: "/ws/x" });
        type("y.md");
        await settle({ query: "/ws/y.md" });
        await new Promise((done) => setTimeout(done, 30));
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/docs", activeIndex: 1 });
        testApp.sendKey("Enter");
        await settle({ query: "/ws/docs/y.md", items: [".."] });
    });

    it("открытие: набранное имя с расширением в каталог не переезжает", async () => {
        const { dialog, settle, type, testApp } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("zz.md");
        await settle({ query: "/ws/zz.md" });
        await new Promise((done) => setTimeout(done, 30));
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/docs", activeIndex: 1 });
        testApp.sendKey("Enter");
        await settle({ query: "/ws/docs/", items: [".."] });
    });

    it("открытие с фильтром расширение не дописывает", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog({ filters: [{ name: "Markdown", extensions: ["md"] }] });
        await settle({ query: "/ws/" });
        type("readme");
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please enter a path that exists.");
        });
    });

    it("Enter сразу после набранного каталога — переход, а не выбор", async () => {
        const { dialog, settle, type, testApp } = await setup();
        let settled = false;
        const result = dialog.showOpenDialog({ canSelectFolders: true });
        void result.then(() => (settled = true));
        await settle({ query: "/ws/" });
        type("src/");
        testApp.sendKey("Enter");
        // Только папки: файлов каталога не видно.
        await settle({ query: "/ws/src/", items: [".."] });
        expect(settled).toBe(false);
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/src")]);
    });

    it("ответ stat каталога про устаревший набор не подгружает его", async () => {
        const { dialog, settle, type, testApp, files, view } = await setup();
        void dialog.showOpenDialog({ defaultUri: Uri.file("/ws/src") });
        await settle({ query: "/ws/src/", items: ["..", "a.ts", "b.ts"] });
        const { started, release } = holdStat(files, "/ws");
        testApp.sendKey("Backspace");
        testApp.sendKey("Backspace");
        await started();
        type("c");
        release();
        await new Promise((done) => setTimeout(done, 50));
        expect(view()).toMatchObject({ query: "/ws/src", items: ["..", "a.ts", "b.ts"] });
    });
});
