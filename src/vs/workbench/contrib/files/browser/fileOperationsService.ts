import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { FileClipboardEntry, IFileClipboard } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import { FileClipboardDIToken } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
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
import type { ResourceFileEdit } from "../../bulkEdit/common/workspaceEdit.ts";
import { WorkspaceEditService, WorkspaceEditServiceDIToken } from "../../bulkEdit/node/workspaceEditService.ts";

import type { ExplorerService } from "./explorerService.ts";
import { ExplorerServiceDIToken } from "./explorerService.ts";

export const FileOperationsServiceDIToken = token<FileOperationsService>("FileOperationsService");

/**
 * Промпт ввода имени/пути (InputBox) — узкий срез `QuickInputService.input`
 * (соответствует структурно). Оставлен интерфейсом, чтобы юнит-тесты могли
 * подставлять фейковый промпт; в DI шов замкнут на `QuickInputServiceDIToken`.
 */
export interface IExplorerInputPrompt {
    input(options: {
        title?: string;
        placeholder?: string;
        value?: string;
        validateInput?: (value: string) => string | null;
    }): Promise<string | undefined>;
}

/**
 * Превращает содержимое файлового буфера в набор `ResourceFileEdit` для вставки в `targetDir`:
 * режим `cut` → перемещение, `copy` → копирование. Исполнение и запись в историю отмены —
 * на стороне `WorkspaceEditService.applyFileEdits`.
 */
export function buildPasteEdits(entry: FileClipboardEntry, targetDir: string): ResourceFileEdit[] {
    return entry.paths.map(
        (from): ResourceFileEdit =>
            entry.mode === "cut" ? { kind: "move", from, to: targetDir } : { kind: "copy", from, to: targetDir },
    );
}

/**
 * Файловые операции Explorer'а: создание/переименование/удаление, copy/cut/paste
 * через {@link IFileClipboard} и workspace-undo/redo. Исполнение правок — через
 * обратимый {@link WorkspaceEditService}; подтверждения — {@link DialogService};
 * дерево обновляется/раскрывается через {@link ExplorerService}.
 */
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
    ) {}

    /**
     * Как отменить удаление: подпись действующего бинда workspace-undo дерева
     * (под `listFocus` — дерево в фокусе, пока открыт диалог, его нет) либо, без
     * бинда, общий путь через корзину.
     */
    private undoHint(): string {
        const chord = this.keybindings.getKeybindingForCommand("fileOperations.undo", this.contextKeys, {
            listFocus: true,
        });
        if (chord === undefined) return "Можно восстановить из корзины.";
        return `Можно восстановить (${formatKeybinding(chord, keybindingLabelStyle(this.contextKeys))} или из корзины).`;
    }

    /** Кладёт выбранные в дереве пути в файловый буфер (режим copy). */
    public copySelected(): void {
        const paths = this.explorer.getSelectedPaths();
        if (paths.length > 0) this.fileClipboard.write(paths, "copy");
    }

    /** Кладёт выбранные в дереве пути в файловый буфер (режим cut). */
    public cutSelected(): void {
        const paths = this.explorer.getSelectedPaths();
        if (paths.length > 0) this.fileClipboard.write(paths, "cut");
    }

    /** Вставляет содержимое файлового буфера в каталог под курсором дерева. */
    public paste(): void {
        const targetDir = this.explorer.getPasteTargetDir();
        if (!targetDir) return;
        const entry = this.fileClipboard.read();
        if (!entry) return;
        this.workspaceEditService.applyFileEdits(
            buildPasteEdits(entry, targetDir),
            entry.mode === "cut" ? "Move" : "Paste",
        );
        if (entry.mode === "cut") this.fileClipboard.clear();
        void this.explorer.refresh();
    }

    /** Удаление файла: подтверждение (всегда — если безвозвратно) + запись в историю отмены. */
    public requestDeleteFile(filePath: string): void {
        const willTrash = this.workspaceEditService.willMoveToTrash();
        const confirmDelete = this.configurationService.get<boolean>("explorer.confirmDelete", true) ?? true;
        const name = path.basename(filePath);

        const doDelete = (): void => {
            this.workspaceEditService.applyFileEdits([{ kind: "delete", from: filePath }], "Delete");
            void this.explorer.refresh();
        };

        // Безвозвратное удаление подтверждаем всегда (необратимо); удаление в корзину — по настройке.
        if (willTrash && !confirmDelete) {
            doDelete();
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
            { onConfirm: doDelete },
        );
    }

    /** Отмена последней файловой операции; для деструктивной — переспрашивает (confirmUndo). */
    public undoWorkspace(): void {
        const element = this.undoRedoService.peekUndo(WORKSPACE_UNDO_CONTEXT);
        if (!element) return;
        const confirmUndo = this.configurationService.get<boolean>("explorer.confirmUndo", true) ?? true;

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

    /** Повтор последней отменённой файловой операции. */
    public redoWorkspace(): void {
        void this.undoRedoService.redo(WORKSPACE_UNDO_CONTEXT).then((ok) => {
            if (ok) void this.explorer.refresh();
        });
    }

    /**
     * New File / New Folder in the explorer (VS Code `explorer.newFile` /
     * `explorer.newFolder`). Prompts for a name relative to the target directory
     * (nested paths like `foo/bar.txt` are allowed and create intermediate dirs),
     * creates it via the undoable {@link WorkspaceEditService}, refreshes and
     * reveals it in the tree, and — for files — opens it in the editor
     * (команда `workbench.openFile`).
     */
    public async runCreate(kind: "file" | "folder", explorerPath?: string): Promise<void> {
        const targetDir = explorerPath
            ? fs.statSync(explorerPath).isDirectory()
                ? explorerPath
                : path.dirname(explorerPath)
            : this.explorer.getPasteTargetDir();
        if (!targetDir) return;

        const name = await this.inputPrompt.input({
            title: kind === "file" ? "New File" : "New Folder",
            placeholder: kind === "file" ? "Enter file name" : "Enter folder name",
            value: "",
            validateInput: (value) => {
                const trimmed = value.trim();
                if (trimmed === "") return "Please enter a name";
                if (path.isAbsolute(trimmed)) return "Please enter a relative name";
                const segments = trimmed.split(/[\\/]/);
                if (segments.some((s) => s === "" || s === "." || s === "..")) return "Invalid name";
                // Сегменты без `.`/`..`/пустых и не абсолютный путь → результат всегда
                // строго внутри targetDir, отдельная проверка на выход не нужна.
                const resolved = path.resolve(targetDir, trimmed);
                if (fs.existsSync(resolved)) return "A file or folder with that name already exists";
                return null;
            },
        });
        if (name === undefined) return;

        const resolved = path.resolve(targetDir, name.trim());
        this.workspaceEditService.applyFileEdits(
            [{ kind: "create", to: resolved, directory: kind === "folder" }],
            kind === "file" ? "New File" : "New Folder",
        );
        await this.explorer.refresh();
        await this.explorer.revealPath(resolved);
        if (kind === "file") {
            this.commands.execute("workbench.openFile", resolved);
        }
    }

    /**
     * Rename a file or folder in the explorer (VS Code `renameFile`, F2). Prompts
     * for the new name pre-filled with the current basename, renames it in place via
     * the undoable {@link WorkspaceEditService}, then refreshes and reveals it.
     */
    public async runRename(filePath: string): Promise<void> {
        const parentDir = path.dirname(filePath);
        const oldName = path.basename(filePath);

        const name = await this.inputPrompt.input({
            title: "Rename",
            placeholder: "Enter new name",
            value: oldName,
            validateInput: (value) => {
                const trimmed = value.trim();
                if (trimmed === "") return "Please enter a name";
                if (path.isAbsolute(trimmed)) return "Please enter a relative name";
                const segments = trimmed.split(/[\\/]/);
                if (segments.some((s) => s === "" || s === "." || s === "..")) return "Invalid name";
                if (trimmed === oldName) return null; // без изменений — валидно, но ниже это no-op
                const resolved = path.resolve(parentDir, trimmed);
                if (fs.existsSync(resolved)) return "A file or folder with that name already exists";
                return null;
            },
        });
        if (name === undefined) return;

        const trimmed = name.trim();
        if (trimmed === oldName) return; // имя не изменилось — ничего не делаем
        const resolved = path.resolve(parentDir, trimmed);
        this.workspaceEditService.applyFileEdits([{ kind: "rename", from: filePath, to: resolved }], "Rename");
        await this.explorer.refresh();
        await this.explorer.revealPath(resolved);
    }

    /**
     * Expand a leading `~` to the home directory, then resolve the path against
     * the current workspace root (falling back to the process cwd). Returns null
     * for an empty input.
     */
    public resolveInputPath(value: string): string | null {
        const trimmed = value.trim();
        if (trimmed === "") return null;
        const expanded =
            trimmed === "~" || trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
        return path.resolve(this.workspaceRoot(), expanded);
    }

    /**
     * Current workspace root, or the process cwd when no folder is open. The
     * root comes from `IWorkspaceContextService`; `folders.at(0)` is the visible
     * narrowing to today's single-folder semantics (with several folders the
     * reference resolves input against the active editor's folder — stage F in
     * docs/TODO/MultiRoot.md).
     */
    private workspaceRoot(): string {
        return this.workspaceContext.getWorkspace().folders.at(0)?.uri.fsPath ?? process.cwd();
    }
}
