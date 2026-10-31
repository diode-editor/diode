import * as fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";

const FIXTURE = extensionFixture("test.documentStateEdges", "documentStateEdges.cjs");

async function withHarness(run: (harness: IExtensionHarness) => Promise<void>, content = "a\nb\n"): Promise<void> {
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

const activeFile = (harness: IExtensionHarness): string => harness.group.getActiveEditor()?.uri.fsPath ?? "";

describe("ExtensionHost — a line ending change reaches the document", () => {
    it("[api:TextEditorEdit.setEndOfLine] getText and offsets use the new ending, the version moves", async () => {
        await withHarness(async (harness) => {
            const state = await execute<Record<string, unknown>>(harness, "test.edges.setEolViaEditor");
            expect(state).toMatchObject({
                text: "a\r\nb\r\n",
                eol: 2,
                offsetOfSecondLine: 3,
                version: (state.before as number) + 1,
            });
        });
    });

    it("[api:TextEdit.setEndOfLine] through applyEdit getText uses the new ending", async () => {
        await withHarness(async (harness) => {
            const state = await execute<Record<string, unknown>>(harness, "test.edges.setEolViaApplyEdit");
            expect(state).toMatchObject({ text: "a\r\nb\r\n", eol: 2 });
        });
    });
});

describe("ExtensionHost — onDidChangeTextDocument follows the document state", () => {
    it("[api:workspace.onDidChangeTextDocument] fires on a line ending change and on the save, as upstream", async () => {
        await withHarness(async (harness) => {
            const seen = await execute<{ afterEdit: number; afterEol: number; afterSave: number; last: unknown }>(
                harness,
                "test.edges.changeEvents",
            );
            expect(seen.afterEol).toBeGreaterThan(seen.afterEdit);
            expect(seen.afterSave).toBeGreaterThan(seen.afterEol);
            expect(seen.last).toMatchObject({ changes: 0, isDirty: false, eol: 2 });
        });
    });
});

describe("ExtensionHost — a deleted file stays deleted", () => {
    it("[api:WorkspaceEdit.deleteFile] a dirty model without a tab is reverted, saveAll does not bring the file back", async () => {
        await withHarness(async (harness) => {
            const file = harness.writeFile("closed.txt", "one\n");
            const result = await execute(harness, "test.edges.editDeleteOpened", file);
            expect(result).toEqual({ deleted: true, isDirty: false });
            expect(fs.existsSync(file)).toBe(false);
        });
    });

    it("[api:WorkspaceEdit.deleteFile] a dirty tab: saveAll does not bring the file back", async () => {
        await withHarness(async (harness) => {
            const file = activeFile(harness);
            expect(await execute(harness, "test.edges.deleteDirtyTab")).toEqual({ deleted: true });
            expect(fs.existsSync(file)).toBe(false);
        });
    });

    it("[api:WorkspaceEdit.deleteFile] edit and delete in one batch: saveAll does not bring the file back", async () => {
        await withHarness(async (harness) => {
            const file = harness.writeFile("closed.txt", "one\n");
            expect(await execute(harness, "test.edges.editDeleteSameBatch", file)).toEqual({ applied: true });
            expect(fs.existsSync(file)).toBe(false);
        });
    });
});

describe("ExtensionHost — a reload from disk leaves the document clean", () => {
    it("[api:TextDocument.isDirty] an external change on a live document without a tab", async () => {
        await withHarness(async (harness) => {
            const file = harness.writeFile("closed.txt", "one");
            await execute(harness, "test.edges.hold", file);
            fs.writeFileSync(file, "external");
            // The harness has no file watcher: this is the reload it triggers in the app.
            harness.group.textFileModels.get(Uri.file(file))?.revertToDisk();
            await settle();
            expect(await execute(harness, "test.edges.readHeld")).toMatchObject({ text: "external", isDirty: false });
        });
    });
});

describe("ExtensionHost — TextEditorEdit options and closed editors", () => {
    it("[api:TextEditor.edit] edits joined by undoStopAfter/undoStopBefore: false undo as one step", async () => {
        await withHarness(async (harness) => {
            await execute(harness, "test.edges.mergedUndoStops");
            const active = harness.group.getActiveEditor();
            expect(active?.getText()).toBe("21alpha");
            active?.undo();
            expect(active?.getText()).toBe("alpha");
        }, "alpha");
    });

    it("[api:TextEditor.edit] rejects on a closed editor, as upstream", async () => {
        await withHarness(async (harness) => {
            await execute(harness, "test.edges.rememberEditor", harness.writeFile("closed.txt", "one\n"));
            await harness.group.closeAllEditors(harness.group.editorGroups.activeGroup);
            await settle();
            expect(await execute(harness, "test.edges.editRememberedEditor")).toEqual({
                rejected: "TextEditor#edit not possible on closed editors",
            });
        });
    });
});

describe("ExtensionHost — a document far below the 50 MB sync limit stays synced", () => {
    it(
        "[api:TextEditor.edit] an edit that grows the document to 200k lines (1 MB) is seen by the extension",
        { timeout: 30_000 },
        async () => {
            await withHarness(async (harness) => {
                const state = await execute(harness, "test.edges.growPastManyLines", 200_000);
                expect(state).toMatchObject({
                    applied: true,
                    lineCount: 200_001,
                    isDirty: true,
                    version: 2,
                    next: true,
                });
            }, "");
        },
    );
});
