import * as path from "node:path";

import { Uri } from "../../../../base/common/uri.ts";
import { encodeChunks } from "../../../../editor/common/model/encodingStream.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { type IFileService, IFileServiceDIToken, type IFileStat } from "../../../../platform/files/common/files.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import {
    hasWorkspaceFileExtension,
    type IWorkspaceFileContents,
    type IWorkspaceFileReader,
    loadWorkspaceFile,
    WORKSPACE_EXTENSION,
    WorkspaceFileError,
} from "../../../../platform/workspace/common/workspaceFile.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { FileDialogServiceDIToken } from "../../../services/dialogs/browser/fileDialogService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { FileOperationsServiceDIToken } from "./fileOperationsService.ts";

/** Реализует `WorkbenchComponent` (структурно); биндинг — в `Workbench/Modules/WorkbenchModule.ts`. */
export interface IWorkspaceFolderOpener {
    setWorkspaceFolder(dirPath: string): void;
    openWorkspaceFile(filePath: string, contents: IWorkspaceFileContents): void;
}

export const WorkspaceFolderOpenerDIToken = token<IWorkspaceFolderOpener>("WorkspaceFolderOpener");

async function runOpenFile(accessor: ServiceAccessor): Promise<void> {
    const picked = await accessor
        .get(FileDialogServiceDIToken)
        // Без canSelect* диалог выбирает файлы (`_convertOpenOptions` эталона).
        .showOpenDialog({ title: "Open File" });
    const file = picked?.at(0);
    if (file !== undefined) accessor.get(CommandRegistryDIToken).execute("workbench.openFile", file.fsPath);
}

async function runOpenFolder(accessor: ServiceAccessor): Promise<void> {
    const picked = await accessor
        .get(FileDialogServiceDIToken)
        .showOpenDialog({ title: "Open Folder", canSelectFiles: false, canSelectFolders: true });
    const folder = picked?.at(0);
    if (folder !== undefined) accessor.get(WorkspaceFolderOpenerDIToken).setWorkspaceFolder(folder.fsPath);
}

async function runOpenWorkspace(accessor: ServiceAccessor): Promise<void> {
    const quickInput = accessor.get(QuickInputServiceDIToken);
    const fileOperations = accessor.get(FileOperationsServiceDIToken);
    const files = accessor.get(IFileServiceDIToken);
    const reader: IWorkspaceFileReader = {
        readText: async (filePath) => new TextDecoder().decode((await files.readFile(Uri.file(filePath))).value),
        isDirectory: async (filePath) => (await statOrNull(files, filePath))?.isDirectory === true,
    };
    // `null` — файл открывается.
    const check = async (filePath: string): Promise<string | null> => {
        if (!hasWorkspaceFileExtension(filePath)) return `Not a workspace file (*.${WORKSPACE_EXTENSION}): ${filePath}`;
        try {
            await loadWorkspaceFile(filePath, reader);
            return null;
        } catch (err) {
            // Stryker disable next-line ConditionalExpression: loadWorkspaceFile иных отказов не бросает (чтение и stat уже ловятся внутри) — проверка страхует от будущего чужого отказа, а не ветвит поведение
            if (err instanceof WorkspaceFileError) return err.message;
            throw err;
        }
    };

    const target = await quickInput.input({
        title: "Open Workspace from File",
        placeholder: `Enter a .${WORKSPACE_EXTENSION} file path`,
        validateInput: async (value) => {
            const resolved = fileOperations.resolveInputPath(value);
            // Empty is not flagged (fresh prompt shows no error); Enter is a no-op.
            return resolved ? check(resolved) : null;
        },
    });
    if (target === undefined) return;
    // An accepted-but-empty value resolves to null → nothing to open.
    const resolved = fileOperations.resolveInputPath(target);
    if (!resolved) return;
    // Read again rather than reuse the validated copy: the open must see the file
    // as it is now (a failure here rejects the command, like any other).
    const contents = await loadWorkspaceFile(resolved, reader);
    accessor.get(WorkspaceFolderOpenerDIToken).openWorkspaceFile(resolved, contents);
}

/** Файл изменён на диске другим процессом — запись блокируется диалогом Overwrite/Cancel, как dirty-write protection VS Code. */
async function runSave(accessor: ServiceAccessor): Promise<void> {
    const editorService = accessor.get(EditorServiceDIToken);
    // Сохраняем вкладку: у detached-панели (Output) файла нет, и `save()` увёл бы
    // в диалог Save As при обычном Ctrl+S из панели.
    const editor = editorService.getActiveTabEditor();
    if (editor === null) return;
    const outcome = await editor.save();
    if (outcome === "no-file") {
        await runSaveAs(accessor);
        return;
    }
    if (outcome === "conflict") {
        const name = editorService.displayName(editor);
        accessor.get(DialogServiceDIToken).showConfirmDialog(
            {
                title: "Overwrite",
                message: [
                    `The file "${name}" has been changed on disk.`,
                    "Do you want to overwrite the version on disk with your changes?",
                ],
                confirmLabel: "Overwrite",
                cancelLabel: "Cancel",
                defaultButton: "cancel",
            },
            {
                onConfirm: () => {
                    void editor.save({ overwrite: true });
                },
            },
        );
        return;
    }
}

/** Перезапись существующего файла диалог спрашивает сам (вопрос эталона) — здесь подтверждения нет. */
async function runSaveAs(accessor: ServiceAccessor): Promise<void> {
    const editorService = accessor.get(EditorServiceDIToken);
    const editor = editorService.getActiveTabEditor();
    if (!editor) return;
    const files = accessor.get(IFileServiceDIToken);

    // Безымянный буфер стартует от папки воркспейса (без неё — cwd) и предложенного имени `Untitled-3.txt`.
    const folder = accessor.get(IWorkspaceContextServiceDIToken).getWorkspace().folders.at(0)?.uri.fsPath;
    const seed =
        editor.uri.scheme === "file"
            ? editor.uri.fsPath
            : path.join(folder ?? process.cwd(), editorService.suggestedSaveName(editor));
    const target = await accessor
        .get(FileDialogServiceDIToken)
        .showSaveDialog({ title: "Save As", defaultUri: Uri.file(seed) });
    if (target === undefined) return;

    const resolved = target.fsPath;
    try {
        if (editor.fileModel !== null) {
            await editor.saveAs(resolved);
        } else {
            // Синтетике (виртуальный документ, снимок) перепривязать буфер не к чему: копия пишется
            // на диск и открывается обычным файлом, как upstream Save As не-файлового ресурса.
            await files.writeFile(
                Uri.file(resolved),
                await encodeChunks(editor.model.document.createSnapshot(), editor.encoding),
            );
            editorService.openFile(resolved);
        }
        accessor.get(WorkbenchContextKeysDIToken).update();
    } catch (error) {
        // Сбой записи (права, место) — в лог; команда при этом не падает.
        accessor
            .get(ILogServiceDIToken)
            .createLogger("input.keybindings")
            .error("Save As failed", { path: resolved, error: String(error) });
    }
}

export const fileSaveAction: CommandAction = {
    id: "workbench.action.files.save",
    title: "File: Save",
    shortTitle: "Save",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "3_save", order: 10 }],
    keybinding: parseKeybinding("mod+s"),
    keybindings: [parseChord("mod+k s")],
    run(accessor) {
        void runSave(accessor);
    },
};

export const newUntitledFileAction: CommandAction = {
    id: "workbench.action.files.newUntitledFile",
    title: "File: New Untitled File",
    shortTitle: "New Untitled File",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "1_new", order: 10 }],
    keybinding: parseKeybinding("mod+n"),
    run(accessor) {
        accessor.get(EditorServiceDIToken).newUntitled();
        accessor.get(WorkbenchContextKeysDIToken).update();
    },
};

export const fileSaveAsAction: CommandAction = {
    id: "workbench.action.files.saveAs",
    title: "File: Save As...",
    shortTitle: "Save As...",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "3_save", order: 20 }],
    // Alt во второй части обязателен: голая вторая часть аккорда утекает парным keypress'ом
    // в документ (docs/TODO/README.md, «Клавиатура»). Ctrl+Shift+S — там, где терминал различает Shift.
    keybinding: parseChord("ctrl+k alt+s"),
    keybindings: [{ keys: parseKeybinding("mod+shift+s"), when: "tier != 'legacy'" }],
    run(accessor) {
        return runSaveAs(accessor);
    },
};

export const fileOpenAction: CommandAction = {
    id: "workbench.action.files.openFile",
    title: "File: Open File...",
    shortTitle: "Open File...",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "2_open", order: 10 }],
    keybinding: parseKeybinding("mod+o"),
    run(accessor) {
        return runOpenFile(accessor);
    },
};

export const fileOpenFolderAction: CommandAction = {
    id: "workbench.action.files.openFolder",
    title: "File: Open Folder...",
    shortTitle: "Open Folder...",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "2_open", order: 20 }],
    keybinding: parseChord("ctrl+k ctrl+o"),
    run(accessor) {
        return runOpenFolder(accessor);
    },
};

export const openWorkspaceAction: CommandAction = {
    id: "workbench.action.openWorkspace",
    title: "File: Open Workspace from File...",
    shortTitle: "Open Workspace from File...",
    menus: [{ menuId: MenuId.MenubarFileMenu, group: "2_open", order: 30 }],
    run: runOpenWorkspace,
};

/** Session-скоуп: флаг живёт на редакторе, на диск и в настройки не попадает. Без шортката, как в VS Code. */
export const toggleActiveEditorReadonlyInSessionAction: CommandAction = {
    id: "workbench.action.files.toggleActiveEditorReadonlyInSession",
    title: "File: Toggle Active Editor Read-only in Session",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        // Detached-панель (Output) — не вкладка: её read-only принадлежит фиче (`ActiveEditorCanToggleReadonlyContext` эталона).
        if (editor === null || editor.detached) return;
        editor.readOnly = !editor.readOnly;
        // `editorReadonly` — производная от состояния редактора, а не от фокуса: сам не пересчитается.
        accessor.get(WorkbenchContextKeysDIToken).update();
    },
};

/** `null` — пути нет или он недоступен. */
async function statOrNull(files: IFileService, fsPath: string): Promise<IFileStat | null> {
    try {
        return await files.stat(Uri.file(fsPath));
    } catch {
        return null;
    }
}
