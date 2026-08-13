import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TextLabelElement } from "@tuidom/all/ui/text/textLabelElement";
import { createAppTestHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { TestApp } from "../../../TestUtils/TestApp.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../common/coreTokens.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";

import type { WorkbenchComponent } from "./workbenchComponent.ts";

interface TestQuitContext {
    testApp: TestApp;
    workbench: WorkbenchComponent;
    accessor: ServiceAccessor;
    commands: CommandRegistry;
}

function createTestContext(): TestQuitContext {
    const h = createAppTestHarness();
    return {
        testApp: h.testApp,
        workbench: h.workbench,
        accessor: h.container.get(ServiceAccessorDIToken),
        commands: h.commands,
    };
}

/** Save и confirm-save последовательность выхода теперь async (LifecycleService
 *  ждёт promise DialogService.confirmSave) — продолжение после ответа в диалоге
 *  откладывается на микротаск, поэтому ветки надо «прокрутить» перед проверкой. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Workbench quit with save dialog", () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("quits immediately when no unsaved files", () => {
        const { workbench, accessor } = createTestContext();

        workbench.requestQuit(accessor);

        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("shows confirm dialog when there is an unsaved file", () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/quit-test-show.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        workbench.requestQuit(accessor);

        const dialog = testApp.querySelector("#confirmSaveDialog");
        expect(dialog).not.toBeNull();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("aborts quit when Cancel is pressed", () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/quit-test-cancel.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        workbench.requestQuit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onCancel?.();

        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("quits without saving when Don't Save is pressed", async () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/quit-test-dontsave.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        workbench.requestQuit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onDontSave?.();
        await tick();

        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("saves file and quits when Save is pressed", async () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/quit-test-save.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        workbench.requestQuit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onSave?.();
        await tick();

        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("shows dialog for each unsaved file sequentially", async () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/quit-seq-a.txt");
        workbench.focusEditor();
        testApp.sendKey("x");
        workbench.openFile("/tmp/quit-seq-b.txt");
        workbench.focusEditor();
        testApp.sendKey("y");

        workbench.requestQuit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        expect(exitSpy).not.toHaveBeenCalled();

        // Don't Save on first file
        dialog.onDontSave?.();
        await tick();
        expect(exitSpy).not.toHaveBeenCalled();

        // Don't Save on second file → quit
        dialog.onDontSave?.();
        await tick();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("cancelling first dialog in sequence aborts quit entirely", () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/quit-seq-cancel-a.txt");
        workbench.focusEditor();
        testApp.sendKey("x");
        workbench.openFile("/tmp/quit-seq-cancel-b.txt");
        workbench.focusEditor();
        testApp.sendKey("y");

        workbench.requestQuit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onCancel?.();

        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("Ctrl+Q triggers quit flow and shows dialog for unsaved file", () => {
        const { testApp, workbench } = createTestContext();
        workbench.openFile("/tmp/quit-keybinding.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        testApp.sendKey("Ctrl+Q");

        expect(exitSpy).not.toHaveBeenCalled();
        expect(testApp.querySelector("#confirmSaveDialog")).not.toBeNull();
    });

    it("Ctrl+Q quits immediately when no unsaved files", () => {
        const { testApp } = createTestContext();

        testApp.sendKey("Ctrl+Q");

        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("Save on the first dialog proceeds to the next file's dialog before quitting", async () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/quit-seq-save-a.txt");
        workbench.focusEditor();
        testApp.sendKey("x");
        workbench.openFile("/tmp/quit-seq-save-b.txt");
        workbench.focusEditor();
        testApp.sendKey("y");

        workbench.requestQuit(accessor);

        // First dialog: Save → saves file, advances to second dialog (no quit yet).
        const firstDialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        firstDialog.onSave?.();
        await tick();
        expect(exitSpy).not.toHaveBeenCalled();

        // A second dialog is shown for the remaining unsaved file.
        const secondDialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        expect(secondDialog).not.toBeNull();

        // Save on the last file → quit.
        secondDialog.onSave?.();
        await tick();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("skips editors that vanished mid-sequence and still quits", async () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/quit-seq-stale-a.txt");
        workbench.focusEditor();
        testApp.sendKey("x");
        workbench.openFile("/tmp/quit-seq-stale-b.txt");
        workbench.focusEditor();
        testApp.sendKey("y");
        workbench.openFile("/tmp/quit-seq-stale-c.txt");
        workbench.focusEditor();
        testApp.sendKey("z");

        // requestQuit snapshots the dirty editors [0, 1, 2] and shows the dialog for the first one.
        workbench.requestQuit(accessor);
        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        expect(exitSpy).not.toHaveBeenCalled();

        // Tabs 1 and 2 disappear before we answer, so their snapshotted items are now stale.
        const editorGroup = (workbench as unknown as { editorService: EditorService }).editorService;
        editorGroup.closeTab(2);
        editorGroup.closeTab(1);

        // Advancing the sequence walks past the now-missing editors and quits at the end.
        dialog.onDontSave?.();
        await tick();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("mixes Save then Don't Save across the sequence and quits at the end", async () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/quit-seq-mix-a.txt");
        workbench.focusEditor();
        testApp.sendKey("x");
        workbench.openFile("/tmp/quit-seq-mix-b.txt");
        workbench.focusEditor();
        testApp.sendKey("y");

        workbench.requestQuit(accessor);

        const first = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        first.onSave?.();
        await tick();
        expect(exitSpy).not.toHaveBeenCalled();

        const second = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        second.onDontSave?.();
        await tick();
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});

describe("Workbench close-tab confirm flow", () => {
    it("closing a modified tab shows the confirm dialog (no immediate close)", () => {
        const { testApp, workbench } = createTestContext();
        workbench.openFile("/tmp/close-confirm-a.txt");
        workbench.openFile("/tmp/close-confirm-b.txt");
        workbench.focusEditor();
        testApp.sendKey("z"); // modify the active tab

        testApp.sendKey("Ctrl+W");

        expect(testApp.querySelector("#confirmSaveDialog")).not.toBeNull();
        // Both tabs still present — close was deferred to the dialog.
        const tabStrip = testApp.querySelector("EditorTabStripElement");
        expect(tabStrip).not.toBeNull();
    });

    it("Don't Save on the close-tab dialog closes the tab", () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/close-confirm-c.txt");
        workbench.openFile("/tmp/close-confirm-d.txt");
        workbench.focusEditor();
        testApp.sendKey("z");

        const tabStrip = testApp.querySelector("EditorTabStripElement") as unknown as {
            getItemElements: () => readonly unknown[];
        };
        expect(tabStrip.getItemElements()).toHaveLength(2);

        testApp.sendKey("Ctrl+W");
        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onDontSave?.();
        testApp.render();

        expect(tabStrip.getItemElements()).toHaveLength(1);
    });

    it("Save on the close-tab dialog saves and closes the tab", async () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/close-confirm-e.txt");
        workbench.openFile("/tmp/close-confirm-f.txt");
        workbench.focusEditor();
        testApp.sendKey("z");

        const tabStrip = testApp.querySelector("EditorTabStripElement") as unknown as {
            getItemElements: () => readonly unknown[];
        };

        testApp.sendKey("Ctrl+W");
        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onSave?.();
        await tick();
        testApp.render();

        expect(tabStrip.getItemElements()).toHaveLength(1);
    });

    it("Cancel on the close-tab dialog keeps the tab open", () => {
        const { testApp, workbench, accessor } = createTestContext();
        workbench.openFile("/tmp/close-confirm-g.txt");
        workbench.openFile("/tmp/close-confirm-h.txt");
        workbench.focusEditor();
        testApp.sendKey("z");

        const tabStrip = testApp.querySelector("EditorTabStripElement") as unknown as {
            getItemElements: () => readonly unknown[];
        };

        testApp.sendKey("Ctrl+W");
        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onCancel?.();
        testApp.render();

        expect(tabStrip.getItemElements()).toHaveLength(2);
    });
});

/**
 * Метка безымянного буфера в диалоге подтверждения. Раньше эти ветки прятались под
 * `/* v8 ignore ... always have a file path *\/` (неправда — Ctrl+N их достаёт), и
 * диалог писал «untitled», расходясь с меткой вкладки `Untitled-1`.
 */
describe("Workbench — диалог сохранения для безымянного буфера", () => {
    function dialogText(testApp: TestApp): string {
        const dialog = testApp.querySelector("#confirmSaveDialog");
        return (dialog?.querySelectorAll("TextLabelElement") ?? [])
            .map((l) => (l as TextLabelElement).getText())
            .join("\n");
    }

    it("называет буфер Untitled-1, а не «untitled» (quit)", () => {
        const { testApp, workbench, accessor, commands } = createTestContext();
        commands.execute("workbench.action.files.newUntitledFile");
        workbench.focusEditor();
        testApp.sendKey("x");

        workbench.requestQuit(accessor);

        expect(dialogText(testApp)).toContain("Untitled-1");
        expect(dialogText(testApp)).not.toContain("untitled?");
    });

    it("называет буфер Untitled-2, когда закрывают вторую вкладку (close)", () => {
        const { testApp, workbench, commands } = createTestContext();
        commands.execute("workbench.action.files.newUntitledFile");
        commands.execute("workbench.action.files.newUntitledFile");
        workbench.focusEditor();
        testApp.sendKey("x");

        commands.execute("workbench.action.closeActiveEditor");

        expect(dialogText(testApp)).toContain("Untitled-2");
    });
});
