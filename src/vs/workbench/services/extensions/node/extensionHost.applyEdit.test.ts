import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";

// `vscode.workspace.applyEdit` end-to-end с настоящим субпроцессом: расширение
// строит WorkspaceEdit, правки доезжают до буферов ядра undoable-батчами.
// Это фундамент для code actions / rename (#196).

describe("ExtensionHost — workspace.applyEdit (subprocess)", () => {
    it("правка активного документа применяется и откатывается одним undo", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld" },
            extensions: [extensionFixture("test.appliesWorkspaceEdit", "appliesWorkspaceEdit.cjs")],
        });
        try {
            await settle();
            const applied = await harness.commandRegistry.execute("test.applyReplaceActive");
            await settle();
            expect(applied).toBe(true);
            expect(harness.group.getActiveEditor()?.getText()).toBe("HELLO\nworld");

            harness.group.getActiveEditor()?.undo();
            expect(harness.group.getActiveEditor()?.getText()).toBe("hello\nworld");
        } finally {
            await harness.dispose();
        }
    });

    it("multi-file edit применяется ко ВСЕМ открытым документам, включая неактивные", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [extensionFixture("test.appliesWorkspaceEdit", "appliesWorkspaceEdit.cjs")],
        });
        try {
            const second = harness.writeFile("b.txt", "beta");
            harness.group.openFile(second);
            await settle();

            const first = harness.group
                .getEditors()
                .find((editor) => editor.uri.toString() !== Uri.file(second).toString());
            expect(first).toBeDefined();

            const applied = await harness.commandRegistry.execute("test.applyToFiles", [
                first!.uri.fsPath,
                second,
            ]);
            await settle();
            expect(applied).toBe(true);
            expect(first?.getText()).toBe("Xalpha");
            expect(harness.group.getActiveEditor()?.getText()).toBe("Xbeta");
        } finally {
            await harness.dispose();
        }
    });

    it("ресурс, не открытый ни в одной вкладке, отменяет весь edit — false, буферы не тронуты", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [extensionFixture("test.appliesWorkspaceEdit", "appliesWorkspaceEdit.cjs")],
        });
        try {
            await settle();
            const active = harness.group.getActiveEditor();
            const applied = await harness.commandRegistry.execute("test.applyToFiles", [
                active!.uri.fsPath,
                "/nowhere/closed.txt",
            ]);
            await settle();
            expect(applied).toBe(false);
            expect(active?.getText()).toBe("alpha");
        } finally {
            await harness.dispose();
        }
    });

    it("edit с файловой операцией — честный false без применения текста", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "alpha" },
            extensions: [extensionFixture("test.appliesWorkspaceEdit", "appliesWorkspaceEdit.cjs")],
        });
        try {
            await settle();
            const applied = await harness.commandRegistry.execute("test.applyWithFileOp");
            await settle();
            expect(applied).toBe(false);
            expect(harness.group.getActiveEditor()?.getText()).toBe("alpha");
        } finally {
            await harness.dispose();
        }
    });
});
