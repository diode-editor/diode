import { describe, expect, it } from "vitest";

import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { explorerTargetsArg } from "../../../browser/actions/menuContexts.ts";

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
    deleted: (readonly string[])[];
    renamed: string[];
    refreshed: number;
    undone: number;
    redone: number;
}

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
                requestDelete: (paths: readonly string[]) => {
                    calls.deleted.push(paths);
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

    it("is bound to the Delete key while the file tree is focused", () => {
        expect(fileDeleteAction.keybinding).toEqual(parseKeybinding("delete"));
        expect(fileDeleteAction.when).toBe("filesExplorerFocus");
    });

    it("an explicit path (the command API) deletes that path alone", () => {
        const { accessor, calls } = makeAccessor(["/ws/a.txt", "/ws/b.txt"]);
        fileDeleteAction.run(accessor, "/ws/target.txt");
        expect(calls.deleted).toEqual([["/ws/target.txt"]]);
    });

    it("from the Delete key: the whole explorer selection", () => {
        const { accessor, calls } = makeAccessor(["/ws/a.txt", "/ws/b.txt", "/ws/c.txt"]);
        fileDeleteAction.run(accessor);
        expect(calls.deleted).toEqual([["/ws/a.txt", "/ws/b.txt", "/ws/c.txt"]]);
    });

    it("from the context menu: the menu's targets", () => {
        const { accessor, calls } = makeAccessor(["/ws/a.txt"]);
        const [targets] = explorerTargetsArg({
            path: "/ws/b.txt",
            targets: ["/ws/b.txt", "/ws/c.txt"],
            canPaste: false,
        });
        fileDeleteAction.run(accessor, targets);
        expect(calls.deleted).toEqual([["/ws/b.txt", "/ws/c.txt"]]);
    });

    it("without a path and without a selection — an empty list", () => {
        const { accessor, calls } = makeAccessor();
        fileDeleteAction.run(accessor);
        expect(calls.deleted).toEqual([[]]);
    });
});

describe("fileRenameAction", () => {
    it("is bound to F2 while the file tree is focused", () => {
        expect(fileRenameAction.id).toBe("fileOperations.rename");
        expect(fileRenameAction.keybinding).toEqual(parseKeybinding("f2"));
        expect(fileRenameAction.when).toBe("filesExplorerFocus");
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

    it("fileUndoAction delegates to undoWorkspace (Ctrl+Z under filesExplorerFocus)", () => {
        expect(fileUndoAction.keybinding).toEqual(parseKeybinding("mod+z"));
        expect(fileUndoAction.when).toBe("filesExplorerFocus");
        const { accessor, calls } = makeAccessor();
        fileUndoAction.run(accessor);
        expect(calls.undone).toBe(1);
    });

    it("fileRedoAction delegates to redoWorkspace (Ctrl+Shift+Z / Ctrl+Y under filesExplorerFocus)", () => {
        expect(fileRedoAction.keybindings).toEqual([parseKeybinding("mod+shift+z"), parseKeybinding("ctrl+y")]);
        expect(fileRedoAction.when).toBe("filesExplorerFocus");
        const { accessor, calls } = makeAccessor();
        fileRedoAction.run(accessor);
        expect(calls.redone).toBe(1);
    });
});
