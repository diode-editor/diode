import { describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEnvironment } from "../../../../diode/modules/testProfile.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import type { ConfirmDialogOptions } from "../../../browser/parts/dialogs/confirmDialog.ts";
import type { DialogService } from "../../../services/dialogs/browser/dialogService.ts";
import type { WorkspaceEditService } from "../../bulkEdit/browser/workspaceEditService.ts";

import type { ExplorerService } from "./explorerService.ts";
import { FileOperationsService } from "./fileOperationsService.ts";

interface IDeleteRig {
    readonly service: FileOperationsService;
    /** Each `applyFileEdits` call — one undo step. */
    readonly steps: { edits: unknown; label: string }[];
    readonly dialogs: ConfirmDialogOptions[];
    readonly confirm: () => void;
    readonly cancel: () => void;
    readonly refreshes: () => number;
}

function rig(options: { trash?: boolean; confirmDelete?: boolean; directories?: readonly string[] } = {}): IDeleteRig {
    const steps: { edits: unknown; label: string }[] = [];
    const dialogs: ConfirmDialogOptions[] = [];
    const handlers: { onConfirm: () => void; onCancel?: () => void }[] = [];
    let refreshes = 0;
    const keybindings = new KeybindingRegistry();
    keybindings.register(parseKeybinding("mod+z"), "fileOperations.undo", "listFocus");
    const service = new FileOperationsService(
        {
            isDirectory: (p: string) => options.directories?.includes(p) ?? false,
            refresh: () => {
                refreshes++;
                return Promise.resolve();
            },
        } as unknown as ExplorerService,
        {
            willMoveToTrash: () => options.trash ?? true,
            applyFileEdits: (edits: unknown, label: string) => {
                steps.push({ edits, label });
                return Promise.resolve(null);
            },
        } as unknown as WorkspaceEditService,
        {} as UndoRedoService,
        {
            showConfirmDialog: (dialog: ConfirmDialogOptions, h: { onConfirm: () => void; onCancel?: () => void }) => {
                dialogs.push(dialog);
                handlers.push(h);
            },
        } as unknown as DialogService,
        createTestConfigurationService({ "explorer.confirmDelete": options.confirmDelete ?? true }),
        new InMemoryFileClipboard(),
        new CommandRegistry(),
        { input: () => Promise.resolve(undefined) },
        keybindings,
        new ContextKeyService(),
        new WorkspaceContextService(),
        diskFileService(),
        createTestEnvironment(),
    );
    return {
        service,
        steps,
        dialogs,
        confirm: () => handlers.at(-1)?.onConfirm(),
        cancel: () => handlers.at(-1)?.onCancel?.(),
        refreshes: () => refreshes,
    };
}

const files = (...names: string[]): string[] => names.map((name) => `/ws/${name}`);

describe("FileOperationsService.requestDelete — several targets", () => {
    it("moving files to trash: the count, the names, the plural undo hint", () => {
        const r = rig();
        r.service.requestDelete(files("a.txt", "b.txt", "c.txt"));
        expect(r.dialogs).toHaveLength(1);
        expect(r.dialogs[0]).toMatchObject({
            title: "Delete",
            confirmLabel: "Move to Trash",
            defaultButton: "confirm",
        });
        expect(r.dialogs[0].message).toEqual([
            "Are you sure you want to delete the following 3 files?",
            "a.txt",
            "b.txt",
            "c.txt",
            "You can restore these files using the Undo command (Ctrl+Z) or from the Trash.",
        ]);
    });

    it("directories only / a mix of files and directories", () => {
        const dirs = rig({ directories: files("src", "lib") });
        dirs.service.requestDelete(files("src", "lib"));
        expect(dirs.dialogs[0].message[0]).toBe(
            "Are you sure you want to delete the following 2 directories and their contents?",
        );

        const mixed = rig({ directories: files("src") });
        mixed.service.requestDelete(files("a.txt", "src"));
        expect(mixed.dialogs[0].message[0]).toBe(
            "Are you sure you want to delete the following 2 files/directories and their contents?",
        );
    });

    it("lists at most ten names, then the count of the rest", () => {
        const twelve = rig();
        twelve.service.requestDelete(Array.from({ length: 12 }, (_, i) => `/ws/f${i}.txt`));
        const message = twelve.dialogs[0].message as readonly string[];
        expect(message[0]).toBe("Are you sure you want to delete the following 12 files?");
        expect(message.slice(1, -1)).toEqual([
            ...Array.from({ length: 10 }, (_, i) => `f${i}.txt`),
            "...2 additional files not shown",
        ]);

        const eleven = rig();
        eleven.service.requestDelete(Array.from({ length: 11 }, (_, i) => `/ws/f${i}.txt`));
        expect((eleven.dialogs[0].message as readonly string[]).at(-2)).toBe("...1 additional file not shown");

        const ten = rig();
        ten.service.requestDelete(Array.from({ length: 10 }, (_, i) => `/ws/f${i}.txt`));
        expect((ten.dialogs[0].message as readonly string[]).at(-2)).toBe("f9.txt");
    });

    it("without the trash: permanent wording, warning, Cancel by default", () => {
        const r = rig({ trash: false, directories: files("src") });
        r.service.requestDelete(files("a.txt", "src"));
        expect(r.dialogs[0]).toMatchObject({
            confirmLabel: "Delete Permanently",
            warning: true,
            defaultButton: "cancel",
        });
        expect(r.dialogs[0].message).toEqual([
            "⚠ The system Trash is not available.",
            "Are you sure you want to permanently delete the following 2 files/directories and their contents? This action is irreversible!",
            "a.txt",
            "src",
        ]);
    });

    it("confirming deletes all targets in one 'Delete' step, then refreshes once", async () => {
        const r = rig();
        r.service.requestDelete(files("a.txt", "b.txt"));
        expect(r.steps).toEqual([]);
        r.confirm();
        await vi.waitFor(() => {
            expect(r.refreshes()).toBe(1);
        });
        expect(r.steps).toEqual([
            {
                edits: [
                    { kind: "delete", from: "/ws/a.txt" },
                    { kind: "delete", from: "/ws/b.txt" },
                ],
                label: "Delete",
            },
        ]);
    });

    it("cancelling deletes nothing", () => {
        const r = rig();
        r.service.requestDelete(files("a.txt", "b.txt"));
        r.cancel();
        expect(r.steps).toEqual([]);
    });

    it("a path inside another target goes with its ancestor: one target in the dialog and in the step", async () => {
        const r = rig({ directories: files("src", "src/a", "src/a/b") });
        r.service.requestDelete(files("src", "src/x.ts", "src/a", "src/a/b"));
        expect(r.dialogs[0].message).toEqual([
            "Are you sure you want to delete 'src' and its contents?",
            "You can restore this file using the Undo command (Ctrl+Z) or from the Trash.",
        ]);
        r.confirm();
        await vi.waitFor(() => {
            expect(r.steps).toEqual([{ edits: [{ kind: "delete", from: "/ws/src" }], label: "Delete" }]);
        });
    });

    it("`explorer.confirmDelete: false` with the trash deletes all targets without a dialog", async () => {
        const r = rig({ confirmDelete: false });
        r.service.requestDelete(files("a.txt", "b.txt"));
        expect(r.dialogs).toEqual([]);
        await vi.waitFor(() => {
            expect(r.steps).toHaveLength(1);
        });
        expect(r.steps[0].edits).toHaveLength(2);
    });

    it("`explorer.confirmDelete: false` without the trash still asks", () => {
        const r = rig({ trash: false, confirmDelete: false });
        r.service.requestDelete(files("a.txt", "b.txt"));
        expect(r.dialogs).toHaveLength(1);
    });

    it("no targets — no dialog, no step", () => {
        const r = rig();
        r.service.requestDelete([]);
        expect(r.dialogs).toEqual([]);
        expect(r.steps).toEqual([]);
    });
});

describe("FileOperationsService.requestDelete — one target", () => {
    it("a file keeps the old wording", () => {
        const r = rig({ trash: false });
        r.service.requestDelete(files("a.txt"));
        expect(r.dialogs[0].message).toEqual([
            "⚠ The system Trash is not available.",
            "Are you sure you want to permanently delete 'a.txt'? This action is irreversible!",
        ]);
    });

    it("a folder: 'and its contents', in both the trash and the permanent wording", () => {
        const trash = rig({ directories: files("src") });
        trash.service.requestDelete(files("src"));
        expect(trash.dialogs[0].message[0]).toBe("Are you sure you want to delete 'src' and its contents?");

        const permanent = rig({ trash: false, directories: files("src") });
        permanent.service.requestDelete(files("src"));
        expect(permanent.dialogs[0].message[1]).toBe(
            "Are you sure you want to permanently delete 'src' and its contents? This action is irreversible!",
        );
    });
});
