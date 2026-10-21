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

describe("SimpleFileDialog — open", () => {
    it("shows the default folder: path in the input, '..', folders before files, no highlight", async () => {
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

    it("arrow appends the item name selected — the next letter replaces it", async () => {
        const { dialog, settle, testApp, component } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        testApp.sendKey("ArrowDown");
        // ".." is never completed.
        await settle({ query: "/ws/", activeIndex: 0 });
        testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/docs", activeIndex: 1 });
        expect(component.view.inputElement.inputState.selectedText).toBe("docs");
    });

    it("name prefix highlights the item; Enter on a folder goes inside", async () => {
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

    it("a fully typed path is accepted if the file exists", async () => {
        const { dialog, settle, testApp, type } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("readme.md");
        await settle({ query: "/ws/readme.md" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
    });

    it("nonexistent folder with a separator shows the upstream hint", async () => {
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

    it("nonexistent file: Enter does not close, asks for an existing path", async () => {
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

    it("folders only: Enter on a folder path without highlight picks that folder", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showOpenDialog({ canSelectFolders: true, canSelectFiles: false });
        await settle({ query: "/ws/", items: ["..", "docs", "src"] });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws")]);
    });

    it("a file when a folder is requested shows 'Please select a folder.'", async () => {
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

    it("'~/' goes to the home folder", async () => {
        const { dialog, settle, type, testApp } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        for (const key of Array.from("/ws/", () => "Backspace")) testApp.sendKey(key);
        type("~/");
        await settle({ query: "/home/u/", items: ["..", "notes.txt"] });
    });

    it("'..' and Enter go one level up", async () => {
        const { dialog, settle, testApp } = await setup();
        void dialog.showOpenDialog({ defaultUri: Uri.file("/ws/src") });
        await settle({ query: "/ws/src/", items: ["..", "a.ts", "b.ts"] });
        testApp.sendKey("ArrowDown");
        await settle({ activeIndex: 0 });
        testApp.sendKey("Enter");
        await settle({ query: "/ws/", items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("filters hide non-matching files", async () => {
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

describe("SimpleFileDialog — save", () => {
    it("name from defaultUri is in the input, cursor before the extension; Enter picks that path", async () => {
        const { dialog, settle, testApp, component } = await setup();
        const result = dialog.showSaveDialog({ defaultUri: Uri.file("/ws/new.txt"), title: "Save As" });
        await settle({ query: "/ws/new.txt", title: "Save As" });
        // The name without its extension is selected: typing replaces it and ".txt" stays.
        expect(component.view.inputElement.inputState.cursorOffset).toBe("/ws/new".length);
        expect(component.view.inputElement.inputState.selectedText).toBe("new");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/new.txt"));
    });

    it("existing file asks to overwrite: Enter means yes", async () => {
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

    it("declining overwrite (Escape) returns to the dialog", async () => {
        const { dialog, settle, testApp } = await setup();
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/report.txt") });
        await settle({ query: "/ws/report.txt" });
        testApp.sendKey("Enter");
        await settle({ title: "report.txt already exists. Are you sure you want to overwrite it?" });
        testApp.sendKey("Escape");
        await settle({ query: "/ws/report.txt", items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("with filters, a missing extension is appended", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showSaveDialog({
            defaultUri: Uri.file("/ws/notes"),
            filters: [{ name: "Text", extensions: ["txt"] }],
        });
        await settle({ query: "/ws/notes" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/notes.txt"));
    });

    it("a folder instead of a name asks for a new file name", async () => {
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

describe("SimpleFileDialog — typing a path", () => {
    it("Backspace into a folder name lists the parent, the next letter highlights the folder", async () => {
        const { dialog, settle, testApp, type } = await setup();
        void dialog.showOpenDialog({ defaultUri: Uri.file("/ws/src") });
        await settle({ query: "/ws/src/", items: ["..", "a.ts", "b.ts"] });
        // A trailing separator does not change the directory: paths are compared without it.
        testApp.sendKey("Backspace");
        await settle({ query: "/ws/src", items: ["..", "a.ts", "b.ts"] });
        testApp.sendKey("Backspace");
        await settle({ query: "/ws/sr", items: ["..", "docs", "src", "readme.md", "report.txt"], activeIndex: -1 });
        // As upstream, the next letter sets the highlight.
        type("c");
        await settle({ query: "/ws/src", activeIndex: 2 });
    });

    it("'..' goes one level up at once, without a separator", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showOpenDialog({ defaultUri: Uri.file("/ws/src") });
        await settle({ query: "/ws/src/" });
        // "." alone does not change the directory.
        type(".");
        await settle({ query: "/ws/src/.", items: ["..", "a.ts", "b.ts"] });
        type(".");
        await settle({ query: "/ws/", items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("after a nonexistent folder, a trailing '~' goes home", async () => {
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

    it("the bad path hint goes away when the input leads to an existing folder again", async () => {
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

    it("input matches no item: no highlight, Enter takes the input", async () => {
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

    it("input case does not affect the highlight", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("RE");
        await settle({ query: "/ws/RE", activeIndex: 3 });
    });

    it("arrow after typing appends the whole selected name, nothing to append on '..'", async () => {
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

    it("file picked with arrow and Enter returns that file", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        for (let i = 0; i < 4; i++) testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/readme.md", activeIndex: 3 });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
    });

    it("folder picked with arrow and Enter goes inside", async () => {
        const { dialog, settle, testApp, type } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        for (let i = 0; i < 3; i++) testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/src", activeIndex: 2 });
        testApp.sendKey("Enter");
        await settle({ query: "/ws/src/", items: ["..", "a.ts", "b.ts"] });
        // Loading has finished, so further typing highlights again.
        type("b");
        await settle({ query: "/ws/src/b", activeIndex: 2 });
        // Entering the directory was not an accept, so the next Enter accepts the file.
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/src/b.ts")]);
    });
});

describe("SimpleFileDialog — initial folder and modes", () => {
    it("defaultUri to a file: name in the input, cursor at the end; Enter picks that file", async () => {
        const { dialog, settle, testApp, component } = await setup();
        const result = dialog.showOpenDialog({ defaultUri: Uri.file("/ws/readme.md") });
        await settle({ query: "/ws/readme.md", items: ["..", "docs", "src", "readme.md", "report.txt"] });
        expect(component.view.inputElement.inputState.cursorOffset).toBe("/ws/readme.md".length);
        expect(component.view.inputElement.inputState.selectedText).toBe("");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
    });

    it("default folder is missing: input holds it, the list has only '..'", async () => {
        const { dialog, settle } = await setup("/ws/gone");
        void dialog.showOpenDialog();
        await settle({ query: "/ws/gone/", items: [".."] });
    });

    it("no '..' at the file system root", async () => {
        const { dialog, settle } = await setup("/");
        void dialog.showOpenDialog();
        await settle({ query: "/", items: ["home", "ws"] });
    });

    it("files and folders together: files are visible, Enter on a typed folder picks it", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showOpenDialog({ canSelectFiles: true, canSelectFolders: true });
        await settle({ query: "/ws/", items: ["..", "docs", "src", "readme.md", "report.txt"] });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws")]);
    });

    it("files only: Enter on a folder without highlight shows 'Please select a file.'", async () => {
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

describe("SimpleFileDialog — save validation", () => {
    it("without defaultUri: default folder, cursor at the end; the typed name is saved", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        const result = dialog.showSaveDialog();
        await settle({ query: "/ws/", items: ["..", "docs", "src", "readme.md", "report.txt"] });
        expect(component.view.inputElement.inputState.cursorOffset).toBe("/ws/".length);
        type("fresh.md");
        await settle({ query: "/ws/fresh.md" });
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual(Uri.file("/ws/fresh.md"));
    });

    it("invalid name shows 'Please enter a valid file name.'", async () => {
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

    it("missing folder asks: Enter creates it and saves", async () => {
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

    it("missing folder, creation declined: dialog stays, folder is not created", async () => {
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

    it("typing in the prompt means 'no': the prompt closes, the dialog returns", async () => {
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

    it("after declining overwrite, Enter asks again", async () => {
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

    it("a file instead of a folder shows 'Please enter a path that exists.'", async () => {
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

    it("folder creation fails: the dialog returns with the reason", async () => {
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

    it("Enter on a folder while saving enters it, the file name stays, cursor before it", async () => {
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

    it("Escape in the dialog returns undefined", async () => {
        const { dialog, settle, testApp } = await setup();
        const result = dialog.showSaveDialog();
        await settle({ query: "/ws/" });
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });
});

describe("SimpleFileDialog — folders only: creation", () => {
    it("nonexistent folder in an existing folder asks; Enter creates and picks it", async () => {
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

    it("creation declined: no folder, the dialog stays open", async () => {
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

    it("creation fails: message with the reason", async () => {
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

    it("a non-Error file system rejection is shown as a string", async () => {
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

    it("missing parent: does not offer to create", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog({ canSelectFolders: true });
        await settle({ query: "/ws/" });
        type("nope/deeper");
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe("Please enter a path that exists.");
        });
    });

    it("files and folders: nonexistent path asks for an existing path without a prompt", async () => {
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

describe("SimpleFileDialog — accept flow", () => {
    it("arrow clears the validation message", async () => {
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

    it("an accepted answer closes the dialog", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("readme.md");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
        expect(component.isOpen()).toBe(false);
    });

    it("trailing spaces in the typed path do not matter", async () => {
        const { dialog, settle, type, testApp } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("readme.md  ");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/readme.md")]);
    });

    it("Escape during a failing validation returns undefined", async () => {
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

    it("a second Enter while the first is pending adds nothing", async () => {
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

    it("declining overwrite, then Escape in the dialog returns undefined", async () => {
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

    it("erasing the completion clears the highlight, the next letter highlights", async () => {
        const { dialog, settle, type, testApp } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        await settle({ query: "/ws/docs", activeIndex: 1 });
        testApp.sendKey("Backspace");
        await settle({ query: "/ws/", activeIndex: -1 });
        type("s");
        await settle({ query: "/ws/s", activeIndex: 2 });
    });

    it("bad path: further typing keeps the hint, repeating the separator brings it back", async () => {
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

    it("default folder is a file: its folder, name in the input", async () => {
        const { dialog, settle } = await setup("/ws/readme.md");
        void dialog.showOpenDialog();
        await settle({ query: "/ws/readme.md", items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("arrow to '..' after completion moves the cursor to the end, no selection", async () => {
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

/** Holds the load of directory `folder` until `release`. */
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

describe("SimpleFileDialog — while a folder is loading", () => {
    it("Enter right after typing a path into another folder accepts that path", async () => {
        const { dialog, settle, type, testApp } = await setup();
        const result = dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("src/a.ts");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/src/a.ts")]);
    });

    it("Enter waits for loading and judges by the new folder", async () => {
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

    it("text typed during loading stays in the input", async () => {
        const { dialog, settle, type, files } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        const { release } = holdFolder(files, "/ws/src");
        type("src/a");
        release();
        await settle({ query: "/ws/src/a", items: ["..", "a.ts", "b.ts"] });
    });

    it("items of the previous folder are not highlighted while the new one loads", async () => {
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
        // A load without force leaves typed input alone: the line keeps "/ws/src".
        release();
        await settle({ items: ["..", "a.ts", "b.ts"] });
        expect(view()).toMatchObject({ query: "/ws/src" });
    });

    it("a stale load result does not override the fresh one", async () => {
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

/** Holds the stat of path `target` until `release`. */
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

describe("SimpleFileDialog — typing: edge cases", () => {
    it("at the root without loading, typing highlights at once, erasing back to the root does not", async () => {
        const { dialog, settle, type, testApp } = await setup("/");
        void dialog.showOpenDialog();
        await settle({ query: "/", items: ["home", "ws"] });
        type("w");
        await settle({ query: "/w", activeIndex: 1 });
        testApp.sendKey("Backspace");
        await settle({ query: "/", activeIndex: -1 });
    });

    it("'.' does not highlight '..'", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type(".");
        await settle({ query: "/ws/." });
        await new Promise((done) => setTimeout(done, 30));
        await settle({ activeIndex: -1 });
    });

    it("'~' not at the start and not after a bad path is just a letter", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showOpenDialog();
        await settle({ query: "/ws/" });
        type("a~");
        await settle({ query: "/ws/a~" });
        await new Promise((done) => setTimeout(done, 30));
        await settle({ items: ["..", "docs", "src", "readme.md", "report.txt"] });
    });

    it("save: a file picked with arrow stays highlighted, Enter asks about it", async () => {
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

    it("save with a name: typing the prefix of another file does not highlight it", async () => {
        const { dialog, settle, type } = await setup();
        void dialog.showSaveDialog({ defaultUri: Uri.file("/ws/x") });
        await settle({ query: "/ws/x" });
        // The name is selected, so a letter replaces it.
        type("r");
        await settle({ query: "/ws/r" });
        await new Promise((done) => setTimeout(done, 30));
        await settle({ activeIndex: -1 });
    });

    it("save: a typed name with an extension moves into the folder", async () => {
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

    it("open: a typed name with an extension does not move into the folder", async () => {
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

    it("Enter right after a typed folder picks that folder", async () => {
        const { dialog, settle, type, testApp } = await setup();
        const result = dialog.showOpenDialog({ canSelectFolders: true });
        await settle({ query: "/ws/" });
        type("src/");
        testApp.sendKey("Enter");
        await expect(result).resolves.toEqual([Uri.file("/ws/src")]);
    });

    it("Enter on a nonexistent folder shows the ~ hint, not path validation", async () => {
        const { dialog, settle, type, testApp, component } = await setup();
        void dialog.showOpenDialog({ canSelectFolders: true });
        await settle({ query: "/ws/" });
        type("nope/");
        testApp.sendKey("Enter");
        await vi.waitFor(() => {
            expect(component.view.validationMessage).toBe(
                "The path does not exist. Use ~ to go to your home directory.",
            );
        });
        await new Promise((done) => setTimeout(done, 30));
        expect(component.view.validationMessage).toBe("The path does not exist. Use ~ to go to your home directory.");
        expect(component.isOpen()).toBe(true);
    });

    it("a folder stat result for stale input does not load it", async () => {
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
