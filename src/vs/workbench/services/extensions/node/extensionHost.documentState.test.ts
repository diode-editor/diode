import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";

const FIXTURE = extensionFixture("test.documentStateAfterEdit", "documentStateAfterEdit.cjs");

interface IState {
    applied: boolean;
    text: string;
    isDirty: boolean;
    eol: number;
    version: number;
    listed?: boolean;
}

async function withHarness(run: (harness: IExtensionHarness) => Promise<void>, content = "alpha"): Promise<void> {
    const harness = await createExtensionTestHarness({
        initialFile: { name: "a.txt", content },
        extensions: [FIXTURE],
    });
    try {
        await settle();
        await run(harness);
    } finally {
        await harness.dispose();
    }
}

const execute = <T>(harness: IExtensionHarness, id: string, ...args: unknown[]): Promise<T> =>
    harness.commandRegistry.execute(id, ...args) as Promise<T>;

describe("ExtensionHost — the document right after an edit resolves", () => {
    it("[api:TextEditor.edit] the awaited edit is already in getText and isDirty, no waiting", async () => {
        await withHarness(async (harness) => {
            const state = await execute<IState>(harness, "test.state.editorEdit", "日本語🙂 ");
            expect(state).toMatchObject({ applied: true, text: "日本語🙂 alpha", isDirty: true });
            expect(harness.group.getActiveEditor()?.getText()).toBe("日本語🙂 alpha");
        });
    });

    it("[api:TextEditor.edit] of two parallel edits the one built on a stale version is refused", async () => {
        await withHarness(async (harness) => {
            expect(await execute(harness, "test.state.parallelEdits")).toEqual({
                first: true,
                second: false,
                text: "1alpha",
            });
        });
    });

    it("[api:TextEditorEdit.setEndOfLine] the line ending changes, the document is dirty", async () => {
        await withHarness(async (harness) => {
            const state = await execute<IState>(harness, "test.state.setEol");
            expect(state).toMatchObject({ applied: true, isDirty: true, eol: 2 });
        }, "a\nb\n");
    });

    it("[api:commands.registerTextEditorCommand] the builder's edit lands in the tab, one undo removes it", async () => {
        await withHarness(async (harness) => {
            await execute(harness, "test.state.insertViaCommand", "typed ");
            const active = harness.group.getActiveEditor();
            expect(active?.getText()).toBe("typed alpha");
            active?.undo();
            expect(active?.getText()).toBe("alpha");
        });
    });
});

describe("ExtensionHost — a document without a tab is a live model", () => {
    function closedFile(harness: IExtensionHarness): { file: string; uri: Uri } {
        const file = harness.writeFile("closed.txt", "one\n");
        return { file, uri: Uri.file(file) };
    }

    it("[api:workspace.openTextDocument] is listed in textDocuments and has no tab", async () => {
        await withHarness(async (harness) => {
            const { file } = closedFile(harness);
            const state = await execute<IState>(harness, "test.state.open", file);
            expect(state).toMatchObject({ text: "one\n", isDirty: false, listed: true });
            expect(harness.group.getEditors().map((editor) => editor.uri.fsPath)).not.toContain(file);
        });
    });

    it("[api:workspace.applyEdit] the disk stays, isDirty is true; save writes and clears it", async () => {
        await withHarness(async (harness) => {
            const { file } = closedFile(harness);
            await execute(harness, "test.state.open", file);

            const edited = await execute<IState>(harness, "test.state.applyEditToOpened", "X");
            expect(edited).toMatchObject({ applied: true, text: "Xone\n", isDirty: true });
            expect(fs.readFileSync(file, "utf8")).toBe("one\n");

            const saved = await execute<IState>(harness, "test.state.saveOpened");
            expect(saved).toMatchObject({ applied: true, isDirty: false });
            expect(fs.readFileSync(file, "utf8")).toBe("Xone\n");
        });
    });

    it("[api:workspace.applyEdit] a line ending edit makes it dirty; the file changes on save", async () => {
        await withHarness(async (harness) => {
            const { file } = closedFile(harness);
            await execute(harness, "test.state.open", file);

            const edited = await execute<IState>(harness, "test.state.applyEolToOpened");
            expect(edited).toMatchObject({ applied: true, isDirty: true, eol: 2 });
            expect(fs.readFileSync(file, "utf8")).toBe("one\n");

            await execute(harness, "test.state.saveOpened");
            expect(fs.readFileSync(file, "utf8")).toBe("one\r\n");
        });
    });

    it("[api:window.showTextDocument] a tab opened later shows the unsaved edit", async () => {
        await withHarness(async (harness) => {
            const { file } = closedFile(harness);
            await execute(harness, "test.state.open", file);
            await execute(harness, "test.state.applyEditToOpened", "X");

            await execute(harness, "test.state.showOpened");
            await settle();

            const active = harness.group.getActiveEditor();
            expect(active?.uri.fsPath).toBe(file);
            expect(active?.getText()).toBe("Xone\n");
            expect(active?.isModified).toBe(true);
        });
    });

    it("[api:WorkspaceEdit.renameFile] edit, rename, edit: unsaved edits travel, the target is dirty", async () => {
        await withHarness(async (harness) => {
            const { file } = closedFile(harness);
            const target = path.join(path.dirname(file), "renamed.txt");

            const state = await execute<IState>(harness, "test.state.renameDirty", file, target, "AFTER");

            expect(state).toMatchObject({ applied: true, text: "AFTERBEFOREone\n", isDirty: true });
            expect(fs.existsSync(file)).toBe(false);
            expect(fs.readFileSync(target, "utf8")).toBe("one\n");
        });
    });

    it("[api:workspace.saveAll] writes a dirty model without a tab", async () => {
        await withHarness(async (harness) => {
            const { file } = closedFile(harness);
            await execute(harness, "test.state.open", file);
            await execute(harness, "test.state.applyEditToOpened", "X");

            expect(await execute(harness, "test.state.saveAll")).toBe(true);

            expect(fs.readFileSync(file, "utf8")).toBe("Xone\n");
        });
    });

    it("a dirty model without a tab is in the exit confirmation", async () => {
        await withHarness(async (harness) => {
            const { file, uri } = closedFile(harness);
            await execute(harness, "test.state.open", file);
            await execute(harness, "test.state.applyEditToOpened", "X");

            const items = harness.group.collectDirty();
            const item = items.find((candidate) => candidate.name === "closed.txt");
            expect(item?.isStillDirty()).toBe(true);
            await item?.save();
            expect(fs.readFileSync(file, "utf8")).toBe("Xone\n");
            expect(harness.group.textFileModels.get(uri)?.isModified).toBe(false);
            expect(item?.isStillDirty()).toBe(false);
        });
    });
});
