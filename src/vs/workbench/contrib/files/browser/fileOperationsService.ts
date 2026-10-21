import * as path from "node:path";

import { Uri } from "../../../../base/common/uri.ts";
import type { FileClipboardEntry, IFileClipboard } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import { FileClipboardDIToken } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IEnvironmentService } from "../../../../platform/environment/common/environment.ts";
import { IEnvironmentServiceDIToken } from "../../../../platform/environment/common/environment.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    UndoRedoService,
    UndoRedoServiceDIToken,
    WORKSPACE_UNDO_CONTEXT,
} from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { DialogService } from "../../../services/dialogs/browser/dialogService.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { WorkspaceEditService, WorkspaceEditServiceDIToken } from "../../bulkEdit/browser/workspaceEditService.ts";
import type { ResourceFileEdit } from "../../bulkEdit/common/workspaceEdit.ts";

import type { ExplorerService } from "./explorerService.ts";
import { ExplorerServiceDIToken } from "./explorerService.ts";

export const FileOperationsServiceDIToken = token<FileOperationsService>("FileOperationsService");

/** A narrow slice of `QuickInputService.input` (matches structurally). */
export interface IExplorerInputPrompt {
    input(options: {
        title?: string;
        placeholder?: string;
        value?: string;
        validateInput?: (value: string) => string | null | Promise<string | null>;
    }): Promise<string | undefined>;
}

export function buildPasteEdits(entry: FileClipboardEntry, targetDir: string): ResourceFileEdit[] {
    // Like upstream's `resources.distinctParents`: a path whose ancestor is also in the clipboard comes
    // along with the ancestor — so a compact row in a multi-selection is pasted as its head alone.
    const paths = entry.paths.filter(
        (candidate) => !entry.paths.some((other) => candidate.startsWith(other + path.sep)),
    );
    return paths.map(
        (from): ResourceFileEdit =>
            entry.mode === "cut" ? { kind: "move", from, to: targetDir } : { kind: "copy", from, to: targetDir },
    );
}

export class FileOperationsService {
    public static dependencies = [
        ExplorerServiceDIToken,
        WorkspaceEditServiceDIToken,
        UndoRedoServiceDIToken,
        DialogServiceDIToken,
        IConfigurationServiceDIToken,
        FileClipboardDIToken,
        CommandRegistryDIToken,
        QuickInputServiceDIToken,
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
        IWorkspaceContextServiceDIToken,
        IFileServiceDIToken,
        IEnvironmentServiceDIToken,
    ] as const;

    public constructor(
        private readonly explorer: ExplorerService,
        private readonly workspaceEditService: WorkspaceEditService,
        private readonly undoRedoService: UndoRedoService,
        private readonly dialogService: DialogService,
        private readonly configurationService: IConfigurationService,
        private readonly fileClipboard: IFileClipboard,
        private readonly commands: CommandRegistry,
        private readonly inputPrompt: IExplorerInputPrompt,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
        private readonly workspaceContext: IWorkspaceContextService,
        private readonly files: IFileService,
        private readonly environment: IEnvironmentService,
    ) {}

    /**
     * The label of the tree's workspace-undo binding (under `listFocus`: while the dialog is open there
     * is no focus) or, without a binding, the way back through the trash.
     */
    private undoHint(): string {
        const chord = this.keybindings.getKeybindingForCommand("fileOperations.undo", this.contextKeys, {
            listFocus: true,
        });
        if (chord === undefined) return "Можно восстановить из корзины.";
        return `Можно восстановить (${formatKeybinding(chord, keybindingLabelStyle(this.contextKeys))} или из корзины).`;
    }

    public copySelected(): void {
        const paths = this.explorer.getSelectedPaths();
        if (paths.length > 0) this.fileClipboard.write(paths, "copy");
    }

    public cutSelected(): void {
        const paths = this.explorer.getSelectedPaths();
        if (paths.length > 0) this.fileClipboard.write(paths, "cut");
    }

    public async paste(): Promise<void> {
        const targetDir = this.explorer.getPasteTargetDir();
        if (!targetDir) return;
        const entry = this.fileClipboard.read();
        if (!entry) return;
        // Clear the "cut" clipboard right away, before writing to disk: a second Ctrl+V
        // while the first paste is running must not move the same paths again.
        if (entry.mode === "cut") this.fileClipboard.clear();
        await this.workspaceEditService.applyFileEdits(
            buildPasteEdits(entry, targetDir),
            entry.mode === "cut" ? "Move" : "Paste",
        );
        await this.explorer.refresh();
    }

    public requestDeleteFile(filePath: string): void {
        const willTrash = this.workspaceEditService.willMoveToTrash();
        const confirmDelete = this.configurationService.get("explorer.confirmDelete");
        const name = path.basename(filePath);

        const doDelete = async (): Promise<void> => {
            await this.workspaceEditService.applyFileEdits([{ kind: "delete", from: filePath }], "Delete");
            await this.explorer.refresh();
        };

        // Permanent deletion is always confirmed (irreversible); moving to trash depends on the setting.
        if (willTrash && !confirmDelete) {
            void doDelete();
            return;
        }
        this.dialogService.showConfirmDialog(
            willTrash
                ? {
                      title: "Delete",
                      message: [`«${name}» будет перемещён в корзину.`, this.undoHint()],
                      confirmLabel: "Move to Trash",
                      defaultButton: "confirm",
                  }
                : {
                      title: "Delete",
                      message: [
                          "⚠ Системная корзина не найдена.",
                          `«${name}» будет удалён безвозвратно — отменить нельзя.`,
                      ],
                      confirmLabel: "Delete Permanently",
                      warning: true,
                      defaultButton: "cancel",
                  },
            { onConfirm: () => void doDelete() },
        );
    }

    /** Asks again before undoing a destructive operation (confirmUndo). */
    public undoWorkspace(): void {
        const element = this.undoRedoService.peekUndo(WORKSPACE_UNDO_CONTEXT);
        if (!element) return;
        const confirmUndo = this.configurationService.get("explorer.confirmUndo");

        const doUndo = (): void => {
            void this.undoRedoService.undo(WORKSPACE_UNDO_CONTEXT).then((ok) => {
                /* v8 ignore start -- defensive: peekUndo above gates on a non-empty stack, and undo() pops synchronously, so it cannot come back empty */
                if (ok) void this.explorer.refresh();
                /* v8 ignore stop */
            });
        };

        if (element.confirmBeforeUndo && confirmUndo) {
            this.dialogService.showConfirmDialog(
                {
                    title: "Undo",
                    message: element.confirmBeforeUndo,
                    confirmLabel: "Yes",
                    cancelLabel: "No",
                    defaultButton: "cancel",
                },
                { onConfirm: doUndo },
            );
        } else {
            doUndo();
        }
    }

    public redoWorkspace(): void {
        void this.undoRedoService.redo(WORKSPACE_UNDO_CONTEXT).then((ok) => {
            if (ok) void this.explorer.refresh();
        });
    }

    /** Nested paths (`foo/bar.txt`) are allowed and create intermediate directories. */
    public async runCreate(kind: "file" | "folder", explorerPath?: string): Promise<void> {
        const targetDir = explorerPath
            ? (await this.files.stat(Uri.file(explorerPath))).isDirectory
                ? explorerPath
                : path.dirname(explorerPath)
            : this.explorer.getPasteTargetDir();
        if (!targetDir) return;

        const name = await this.inputPrompt.input({
            title: kind === "file" ? "New File" : "New Folder",
            placeholder: kind === "file" ? "Enter file name" : "Enter folder name",
            value: "",
            validateInput: async (value) => {
                const trimmed = value.trim();
                if (trimmed === "") return "Please enter a name";
                if (path.isAbsolute(trimmed)) return "Please enter a relative name";
                const segments = trimmed.split(/[\\/]/);
                if (segments.some((s) => s === "" || s === "." || s === "..")) return "Invalid name";
                // No `.`/`..`/empty segments and not an absolute path → the result is always
                // strictly inside targetDir, so no separate escape check is needed.
                const resolved = path.resolve(targetDir, trimmed);
                if (await this.files.exists(Uri.file(resolved)))
                    return "A file or folder with that name already exists";
                return null;
            },
        });
        if (name === undefined) return;

        const resolved = path.resolve(targetDir, name.trim());
        await this.workspaceEditService.applyFileEdits(
            [{ kind: "create", to: resolved, directory: kind === "folder" }],
            kind === "file" ? "New File" : "New Folder",
        );
        await this.explorer.refresh();
        await this.explorer.revealPath(resolved);
        if (kind === "file") {
            this.commands.execute("workbench.openFile", resolved);
        }
    }

    public async runRename(filePath: string): Promise<void> {
        const parentDir = path.dirname(filePath);
        const oldName = path.basename(filePath);

        const name = await this.inputPrompt.input({
            title: "Rename",
            placeholder: "Enter new name",
            value: oldName,
            validateInput: async (value) => {
                const trimmed = value.trim();
                if (trimmed === "") return "Please enter a name";
                if (path.isAbsolute(trimmed)) return "Please enter a relative name";
                const segments = trimmed.split(/[\\/]/);
                if (segments.some((s) => s === "" || s === "." || s === "..")) return "Invalid name";
                if (trimmed === oldName) return null; // unchanged — valid, but a no-op below
                const resolved = path.resolve(parentDir, trimmed);
                if (await this.files.exists(Uri.file(resolved)))
                    return "A file or folder with that name already exists";
                return null;
            },
        });
        if (name === undefined) return;

        const trimmed = name.trim();
        if (trimmed === oldName) return;
        const resolved = path.resolve(parentDir, trimmed);
        await this.workspaceEditService.applyFileEdits([{ kind: "rename", from: filePath, to: resolved }], "Rename");
        await this.explorer.refresh();
        await this.explorer.revealPath(resolved);
    }

    /** A leading `~` is the home directory; the base is the workspace root (or cwd without one); `null` for empty input. */
    public resolveInputPath(value: string): string | null {
        const trimmed = value.trim();
        if (trimmed === "") return null;
        const expanded =
            trimmed === "~" || trimmed.startsWith("~/")
                ? path.join(this.environment.userHome, trimmed.slice(1))
                : trimmed;
        return path.resolve(this.workspaceRoot(), expanded);
    }

    /**
     * `folders.at(0)` narrows to a single folder; with several, upstream resolves input against the
     * active editor's folder (stage F in docs/TODO/MultiRoot.md).
     */
    private workspaceRoot(): string {
        return this.workspaceContext.getWorkspace().folders.at(0)?.uri.fsPath ?? process.cwd();
    }
}
