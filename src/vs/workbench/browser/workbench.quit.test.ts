import type { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { TestApp } from "../../../TestUtils/TestApp.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import { DialogServiceDIToken } from "../services/dialogs/browser/dialogService.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";
import { HostProcessDIToken } from "../services/lifecycle/common/hostProcess.ts";

import type { WorkbenchComponent } from "./workbenchComponent.ts";

interface TestQuitContext {
    testApp: TestApp;
    workbench: WorkbenchComponent;
    accessor: ServiceAccessor;
    commands: CommandRegistry;
}

/** `exit` is a stubbed exit of the owning process: the real one would take the runner down. */
function createTestContext(exit: () => void = () => undefined): TestQuitContext {
    const h = createAppTestHarness({
        containerOverrides: (container) => {
            container.bind(HostProcessDIToken, () => ({ exit, restart: () => undefined }));
        },
    });
    return {
        testApp: h.testApp,
        workbench: h.workbench,
        accessor: h.container.get(ServiceAccessorDIToken),
        commands: h.commands,
    };
}

/** Quit awaits confirmSave and the participants' shutdown on microtasks — flush the branches before asserting. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function quit(accessor: ServiceAccessor): void {
    accessor.get(CommandRegistryDIToken).execute("workbench.action.quit");
}

describe("Workbench quit with save dialog", () => {
    let exitSpy: Mock<() => void>;

    beforeEach(() => {
        exitSpy = vi.fn();
    });

    it("quits without dialogs when no unsaved files", async () => {
        const { accessor } = createTestContext(exitSpy);

        quit(accessor);
        await tick();

        expect(exitSpy).toHaveBeenCalledOnce();
    });

    it("shows confirm dialog when there is an unsaved file", () => {
        const { testApp, workbench, accessor } = createTestContext(exitSpy);
        workbench.openFile("/tmp/quit-test-show.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        quit(accessor);

        const dialog = testApp.querySelector("#confirmSaveDialog");
        expect(dialog).not.toBeNull();
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("aborts quit when Cancel is pressed", () => {
        const { testApp, workbench, accessor } = createTestContext(exitSpy);
        workbench.openFile("/tmp/quit-test-cancel.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        quit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onCancel?.();

        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("quits without saving when Don't Save is pressed", async () => {
        const { testApp, workbench, accessor } = createTestContext(exitSpy);
        workbench.openFile("/tmp/quit-test-dontsave.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        quit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onDontSave?.();
        await tick();

        expect(exitSpy).toHaveBeenCalledOnce();
    });

    it("saves file and quits when Save is pressed", async () => {
        const { testApp, workbench, accessor } = createTestContext(exitSpy);
        workbench.openFile("/tmp/quit-test-save.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        quit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onSave?.();

        await vi.waitFor(() => {
            expect(exitSpy).toHaveBeenCalledOnce();
        });
    });

    it("shows dialog for each unsaved file sequentially", async () => {
        const { testApp, workbench, accessor } = createTestContext(exitSpy);
        workbench.openFile("/tmp/quit-seq-a.txt");
        workbench.focusEditor();
        testApp.sendKey("x");
        workbench.openFile("/tmp/quit-seq-b.txt");
        workbench.focusEditor();
        testApp.sendKey("y");

        quit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        expect(exitSpy).not.toHaveBeenCalled();

        dialog.onDontSave?.();
        await tick();
        expect(exitSpy).not.toHaveBeenCalled();

        dialog.onDontSave?.();
        await tick();
        expect(exitSpy).toHaveBeenCalledOnce();
    });

    it("cancelling first dialog in sequence aborts quit entirely", () => {
        const { testApp, workbench, accessor } = createTestContext(exitSpy);
        workbench.openFile("/tmp/quit-seq-cancel-a.txt");
        workbench.focusEditor();
        testApp.sendKey("x");
        workbench.openFile("/tmp/quit-seq-cancel-b.txt");
        workbench.focusEditor();
        testApp.sendKey("y");

        quit(accessor);

        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        dialog.onCancel?.();

        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("Ctrl+Q triggers quit flow and shows dialog for unsaved file", () => {
        const { testApp, workbench } = createTestContext(exitSpy);
        workbench.openFile("/tmp/quit-keybinding.txt");
        workbench.focusEditor();
        testApp.sendKey("x");

        testApp.sendKey("Ctrl+Q");

        expect(exitSpy).not.toHaveBeenCalled();
        expect(testApp.querySelector("#confirmSaveDialog")).not.toBeNull();
    });

    it("Ctrl+Q quits without dialogs when no unsaved files", async () => {
        const { testApp } = createTestContext(exitSpy);

        testApp.sendKey("Ctrl+Q");
        await tick();

        expect(exitSpy).toHaveBeenCalledOnce();
    });

    it("Save on the first dialog proceeds to the next file's dialog before quitting", async () => {
        const { testApp, workbench, accessor } = createTestContext(exitSpy);
        workbench.openFile("/tmp/quit-seq-save-a.txt");
        workbench.focusEditor();
        testApp.sendKey("x");
        workbench.openFile("/tmp/quit-seq-save-b.txt");
        workbench.focusEditor();
        testApp.sendKey("y");

        quit(accessor);

        const firstDialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        firstDialog.onSave?.();
        await tick();
        expect(exitSpy).not.toHaveBeenCalled();

        await vi.waitFor(() => {
            expect(accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()).not.toBeNull();
        });
        const secondDialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;

        secondDialog.onSave?.();
        await vi.waitFor(() => {
            expect(exitSpy).toHaveBeenCalledOnce();
        });
    });

    it("skips editors that vanished mid-sequence and still quits", async () => {
        const { testApp, workbench, accessor } = createTestContext(exitSpy);
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
        quit(accessor);
        const dialog = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        expect(exitSpy).not.toHaveBeenCalled();

        // Tabs 1 and 2 disappear before we answer, so their snapshotted items are now stale.
        const editorGroup = (workbench as unknown as { editorService: IEditorService }).editorService;
        editorGroup.editorGroups.activeGroup.closeTab(2);
        editorGroup.editorGroups.activeGroup.closeTab(1);

        dialog.onDontSave?.();
        await tick();
        expect(exitSpy).toHaveBeenCalledOnce();
    });

    it("Save of an untitled buffer on quit does not save: quit is canceled, the text survives", async () => {
        const { testApp, workbench, accessor, commands } = createTestContext(exitSpy);
        commands.execute("workbench.action.files.newUntitledFile");
        workbench.focusEditor();
        testApp.sendKey("x");

        quit(accessor);
        accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()?.onSave?.();
        await tick();

        // There is nowhere to save ("no-file") — as with closing a tab: a veto, not a quit
        // that loses the text.
        expect(exitSpy).not.toHaveBeenCalled();
        expect(accessor.get(EditorServiceDIToken).getEditors()[0].isModified).toBe(true);
    });

    it("mixes Save then Don't Save across the sequence and quits at the end", async () => {
        const { testApp, workbench, accessor } = createTestContext(exitSpy);
        workbench.openFile("/tmp/quit-seq-mix-a.txt");
        workbench.focusEditor();
        testApp.sendKey("x");
        workbench.openFile("/tmp/quit-seq-mix-b.txt");
        workbench.focusEditor();
        testApp.sendKey("y");

        quit(accessor);

        const first = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        first.onSave?.();
        await tick();
        expect(exitSpy).not.toHaveBeenCalled();

        await vi.waitFor(() => {
            expect(accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()).not.toBeNull();
        });
        const second = accessor.get(DialogServiceDIToken).getOpenConfirmSaveDialog()!;
        second.onDontSave?.();
        await tick();
        expect(exitSpy).toHaveBeenCalledOnce();
    });
});

describe("Workbench close-tab confirm flow", () => {
    it("closing a modified tab shows the confirm dialog (no immediate close)", () => {
        const { testApp, workbench } = createTestContext();
        workbench.openFile("/tmp/close-confirm-a.txt");
        workbench.openFile("/tmp/close-confirm-b.txt");
        workbench.focusEditor();
        testApp.sendKey("z");

        testApp.sendKey("Ctrl+W");

        expect(testApp.querySelector("#confirmSaveDialog")).not.toBeNull();
        const tabStrip = testApp.querySelector("EditorTabStripElement");
        expect(tabStrip).not.toBeNull();
    });

    it("Don't Save on the close-tab dialog closes the tab", async () => {
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
        await tick();
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

        await vi.waitFor(() => {
            testApp.render();
            expect(tabStrip.getItemElements()).toHaveLength(1);
        });
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

// The dialog must name an untitled buffer as its tab does (`Untitled-1`).
describe("Workbench: save dialog for an untitled buffer", () => {
    function dialogText(testApp: TestApp): string {
        const dialog = testApp.querySelector("#confirmSaveDialog");
        return (dialog?.querySelectorAll("TextLabelElement") ?? [])
            .map((l) => (l as TextLabelElement).getText())
            .join("\n");
    }

    it("names the buffer Untitled-1, not 'untitled' (quit)", () => {
        const { testApp, workbench, accessor, commands } = createTestContext();
        commands.execute("workbench.action.files.newUntitledFile");
        workbench.focusEditor();
        testApp.sendKey("x");

        quit(accessor);

        expect(dialogText(testApp)).toContain("Untitled-1");
        expect(dialogText(testApp)).not.toContain("untitled?");
    });

    it("names the buffer Untitled-2 when the second tab is closed (close)", () => {
        const { testApp, workbench, commands } = createTestContext();
        commands.execute("workbench.action.files.newUntitledFile");
        commands.execute("workbench.action.files.newUntitledFile");
        workbench.focusEditor();
        testApp.sendKey("x");

        commands.execute("workbench.action.closeActiveEditor");

        expect(dialogText(testApp)).toContain("Untitled-2");
    });
});
