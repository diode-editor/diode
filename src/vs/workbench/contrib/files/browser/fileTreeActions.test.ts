import { describe, expect, it } from "vitest";

import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { type ExplorerService, ExplorerServiceDIToken } from "./explorerService.ts";
import { type FileOperationsService, FileOperationsServiceDIToken } from "./fileOperationsService.ts";
import {
    fileDeleteAction,
    fileRedoAction,
    fileRenameAction,
    fileUndoAction,
    refreshExplorerAction,
} from "./fileTreeActions.ts";

interface StubCalls {
    deleted: string[];
    renamed: string[];
    refreshed: number;
    undone: number;
    redone: number;
}

/** Аксессор со стабами Explorer-сервисов; наблюдаемые вызовы — в `calls`. */
function makeAccessor(selectedPaths: string[] = []): { accessor: Container; calls: StubCalls } {
    const calls: StubCalls = { deleted: [], renamed: [], refreshed: 0, undone: 0, redone: 0 };
    const accessor = new Container();
    accessor.bind(
        ExplorerServiceDIToken,
        () =>
            ({
                getSelectedPaths: () => selectedPaths,
                refresh: async () => {
                    calls.refreshed++;
                },
            }) as unknown as ExplorerService,
    );
    accessor.bind(
        FileOperationsServiceDIToken,
        () =>
            ({
                requestDeleteFile: (filePath: string) => {
                    calls.deleted.push(filePath);
                },
                runRename: async (filePath: string) => {
                    calls.renamed.push(filePath);
                },
                undoWorkspace: () => {
                    calls.undone++;
                },
                redoWorkspace: () => {
                    calls.redone++;
                },
            }) as unknown as FileOperationsService,
    );
    return { accessor, calls };
}

describe("fileDeleteAction", () => {
    it("has correct id and title", () => {
        expect(fileDeleteAction.id).toBe("fileOperations.deleteFile");
        expect(fileDeleteAction.title).toBe("File: Delete");
    });

    it("is bound to the Delete key while a list is focused", () => {
        expect(fileDeleteAction.keybinding).toEqual(parseKeybinding("delete"));
        expect(fileDeleteAction.when).toBe("listFocus");
    });

    it("delegates an explicit path to FileOperationsService.requestDeleteFile", () => {
        const { accessor, calls } = makeAccessor();
        fileDeleteAction.run(accessor, "/ws/target.txt");
        expect(calls.deleted).toEqual(["/ws/target.txt"]);
    });

    it("falls back to the explorer selection when no path is given", () => {
        const { accessor, calls } = makeAccessor(["/ws/selected.txt"]);
        fileDeleteAction.run(accessor);
        expect(calls.deleted).toEqual(["/ws/selected.txt"]);
    });

    it("is a no-op without a path and without a selection", () => {
        const { accessor, calls } = makeAccessor();
        fileDeleteAction.run(accessor);
        expect(calls.deleted).toEqual([]);
    });
});

describe("fileRenameAction", () => {
    it("is bound to F2 while a list is focused", () => {
        expect(fileRenameAction.id).toBe("fileOperations.rename");
        expect(fileRenameAction.keybinding).toEqual(parseKeybinding("f2"));
        expect(fileRenameAction.when).toBe("listFocus");
    });

    it("delegates an explicit path to FileOperationsService.runRename", () => {
        const { accessor, calls } = makeAccessor();
        fileRenameAction.run(accessor, "/ws/old.txt");
        expect(calls.renamed).toEqual(["/ws/old.txt"]);
    });

    it("falls back to the explorer selection when no path is given", () => {
        const { accessor, calls } = makeAccessor(["/ws/selected.txt"]);
        fileRenameAction.run(accessor);
        expect(calls.renamed).toEqual(["/ws/selected.txt"]);
    });

    it("is a no-op without a path and without a selection", () => {
        const { accessor, calls } = makeAccessor();
        fileRenameAction.run(accessor);
        expect(calls.renamed).toEqual([]);
    });
});

describe("refreshExplorerAction / undo / redo / context menu", () => {
    it("refreshExplorerAction refreshes the explorer tree", () => {
        const { accessor, calls } = makeAccessor();
        refreshExplorerAction.run(accessor);
        expect(calls.refreshed).toBe(1);
    });

    it("fileUndoAction delegates to undoWorkspace (Ctrl+Z under listFocus)", () => {
        expect(fileUndoAction.keybinding).toEqual(parseKeybinding("ctrl+z"));
        expect(fileUndoAction.when).toBe("listFocus");
        const { accessor, calls } = makeAccessor();
        fileUndoAction.run(accessor);
        expect(calls.undone).toBe(1);
    });

    it("fileRedoAction delegates to redoWorkspace (Ctrl+Shift+Z / Ctrl+Y under listFocus)", () => {
        expect(fileRedoAction.keybindings).toEqual([parseKeybinding("ctrl+shift+z"), parseKeybinding("ctrl+y")]);
        expect(fileRedoAction.when).toBe("listFocus");
        const { accessor, calls } = makeAccessor();
        fileRedoAction.run(accessor);
        expect(calls.redone).toBe(1);
    });

});
