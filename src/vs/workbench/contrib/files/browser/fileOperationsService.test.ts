import { describe, expect, it } from "vitest";

import { createTempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import type { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { DialogService } from "../../../services/dialogs/browser/dialogService.ts";
import type { WorkspaceEditService } from "../../bulkEdit/node/workspaceEditService.ts";

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
        NULL_CONFIGURATION_SERVICE,
        new InMemoryFileClipboard(),
        new CommandRegistry(),
        cancelledPrompt,
    );
    return { service, edits };
}

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
