import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEnvironment } from "../../../../diode/modules/testProfile.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import type { DialogService } from "../../../services/dialogs/browser/dialogService.ts";
import type { WorkspaceEditService } from "../../bulkEdit/browser/workspaceEditService.ts";

import type { ExplorerService } from "./explorerService.ts";
import { FileOperationsService } from "./fileOperationsService.ts";

/**
 * Юнит-крайности FileOperationsService: отменённый промпт (Escape / клик мимо →
 * `input()` резолвится undefined) оставляет create/rename no-op'ом. Основные
 * флоу покрыты интеграционно (Workbench.FileCreate/FileRename/FileDelete/…).
 */
function makeService(explorer: Partial<ExplorerService>): { service: FileOperationsService; edits: unknown[] } {
    const edits: unknown[] = [];
    const workspaceEdits = {
        applyFileEdits: (list: unknown) => {
            edits.push(list);
            return null;
        },
    } as unknown as WorkspaceEditService;
    // Промпт, который пользователь сразу отменяет (шов IExplorerInputPrompt).
    const cancelledPrompt = { input: () => Promise.resolve(undefined) };
    const service = new FileOperationsService(
        explorer as ExplorerService,
        workspaceEdits,
        {} as UndoRedoService,
        {} as DialogService,
        createTestConfigurationService(),
        new InMemoryFileClipboard(),
        new CommandRegistry(),
        cancelledPrompt,
        new KeybindingRegistry(),
        new ContextKeyService(),
        new WorkspaceContextService(),
        diskFileService(),
        createTestEnvironment(),
    );
    return { service, edits };
}

describe("FileOperationsService.resolveInputPath", () => {
    it("`~` и `~/…` разворачиваются в домашний каталог окружения", () => {
        const { service } = makeService({});
        expect(service.resolveInputPath("~")).toBe(os.homedir());
        expect(service.resolveInputPath(" ~/notes.md ")).toBe(path.join(os.homedir(), "notes.md"));
        expect(service.resolveInputPath("   ")).toBeNull();
    });
});

describe("FileOperationsService — отменённый промпт", () => {
    it("runCreate is a no-op when the prompt is cancelled", async () => {
        const ws = createTempWorkspace({ prefix: "diode-fileops-" });
        const { service, edits } = makeService({ getPasteTargetDir: () => ws.dir });

        await expect(service.runCreate("file")).resolves.toBeUndefined();
        expect(edits).toEqual([]);
        ws.dispose();
    });

    it("runRename is a no-op when the prompt is cancelled", async () => {
        const { service, edits } = makeService({});

        await expect(service.runRename("/ws/old.txt")).resolves.toBeUndefined();
        expect(edits).toEqual([]);
    });
});

describe("FileOperationsService — подсказка отмены в диалоге удаления в корзину", () => {
    function trashHint(bind: string | null, isMac: boolean): unknown {
        const shown: { message?: unknown }[] = [];
        const keybindings = new KeybindingRegistry();
        if (bind !== null) keybindings.register(parseKeybinding(bind), "fileOperations.undo", "listFocus");
        const contextKeys = new ContextKeyService();
        contextKeys.set("isMac", isMac);
        contextKeys.set("macKeys", isMac ? 3 : 0);
        const service = new FileOperationsService(
            {} as ExplorerService,
            { willMoveToTrash: () => true } as unknown as WorkspaceEditService,
            {} as UndoRedoService,
            { showConfirmDialog: (options: { message?: unknown }) => shown.push(options) } as unknown as DialogService,
            createTestConfigurationService(),
            new InMemoryFileClipboard(),
            new CommandRegistry(),
            { input: () => Promise.resolve(undefined) },
            keybindings,
            contextKeys,
            new WorkspaceContextService(),
            diskFileService(),
            createTestEnvironment(),
        );
        service.requestDeleteFile("/ws/a.txt");
        return shown[0].message;
    }

    it("подпись действующего бинда отмены дерева — по ОС клавиатуры (дерево «в фокусе»)", () => {
        expect(trashHint("mod+z", false)).toEqual([
            "«a.txt» будет перемещён в корзину.",
            "Можно восстановить (Ctrl+Z или из корзины).",
        ]);
        expect(trashHint("mod+z", true)).toEqual([
            "«a.txt» будет перемещён в корзину.",
            "Можно восстановить (⌘Z или из корзины).",
        ]);
    });

    it("без бинда отмены — только путь через корзину", () => {
        expect(trashHint(null, false)).toEqual([
            "«a.txt» будет перемещён в корзину.",
            "Можно восстановить из корзины.",
        ]);
    });
});

describe("FileOperationsService — что уходит исполнителю правок", () => {
    function recording(answer?: string): {
        service: FileOperationsService;
        calls: { edits: unknown; label: string }[];
        clipboard: InMemoryFileClipboard;
    } {
        const calls: { edits: unknown; label: string }[] = [];
        const clipboard = new InMemoryFileClipboard();
        const service = new FileOperationsService(
            {
                getPasteTargetDir: () => "/ws/target",
                refresh: () => Promise.resolve(),
                revealPath: () => Promise.resolve(true),
            } as unknown as ExplorerService,
            {
                willMoveToTrash: () => true,
                applyFileEdits: (edits: unknown, label: string) => {
                    calls.push({ edits, label });
                    return Promise.resolve(null);
                },
            } as unknown as WorkspaceEditService,
            {} as UndoRedoService,
            {} as DialogService,
            createTestConfigurationService({ "explorer.confirmDelete": false }),
            clipboard,
            new CommandRegistry(),
            { input: () => Promise.resolve(answer) },
            new KeybindingRegistry(),
            new ContextKeyService(),
            new WorkspaceContextService(),
            diskFileService(),
            createTestEnvironment(),
        );
        return { service, calls, clipboard };
    }

    it("удаление без подтверждения — шаг «Delete»", async () => {
        const { service, calls } = recording();
        service.requestDeleteFile("/ws/a.txt");
        await vi.waitFor(() => {
            expect(calls).toEqual([{ edits: [{ kind: "delete", from: "/ws/a.txt" }], label: "Delete" }]);
        });
    });

    it("переименование — шаг «Rename» на точный путь", async () => {
        const { service, calls } = recording("b.txt");
        await service.runRename("/ws/a.txt");
        expect(calls).toEqual([
            { edits: [{ kind: "rename", from: "/ws/a.txt", to: path.resolve("/ws", "b.txt") }], label: "Rename" },
        ]);
    });

    it("вставка вырезанного — шаг «Move», буфер пустеет", async () => {
        const { service, calls, clipboard } = recording();
        clipboard.write(["/ws/a.txt"], "cut");
        await service.paste();
        expect(calls.map((call) => call.label)).toEqual(["Move"]);
        expect(clipboard.read()).toBeNull();
    });

    it("вставка скопированного — шаг «Paste», буфер остаётся", async () => {
        const { service, calls, clipboard } = recording();
        clipboard.write(["/ws/a.txt"], "copy");
        await service.paste();
        expect(calls.map((call) => call.label)).toEqual(["Paste"]);
        expect(clipboard.read()).toEqual({ paths: ["/ws/a.txt"], mode: "copy" });
    });
});
