import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";

describe("ExtensionHost — editor write API (subprocess)", () => {
    it("editor.edit(insert) применяет правку к активному редактору (undoable)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld" },
            extensions: [extensionFixture("test.editsActiveEditor", "editsActiveEditor.cjs")],
        });
        try {
            await settle();
            const applied = await harness.commandRegistry.execute("test.insertX");
            await settle();
            expect(applied).toBe(true);
            expect(harness.group.getActiveEditor()?.getText()).toBe("Xhello\nworld");

            harness.group.getActiveEditor()?.undo();
            expect(harness.group.getActiveEditor()?.getText()).toBe("hello\nworld");
        } finally {
            await harness.dispose();
        }
    });

    it("editor.selection = ... выставляет выделение активного редактора", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld" },
            extensions: [extensionFixture("test.editsActiveEditor", "editsActiveEditor.cjs")],
        });
        try {
            await settle();
            await harness.commandRegistry.execute("test.selectFirstLine");
            await settle();
            const sel = harness.group.getActiveEditor()?.viewState.selections[0];
            expect(sel?.anchor).toEqual({ line: 0, character: 0 });
            expect(sel?.active).toEqual({ line: 0, character: 3 });
        } finally {
            await harness.dispose();
        }
    });

    it("editor.edit(delete) удаляет диапазон", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld" },
            extensions: [extensionFixture("test.editsActiveEditor", "editsActiveEditor.cjs")],
        });
        try {
            await settle();
            const applied = await harness.commandRegistry.execute("test.deleteFirstLine");
            await settle();
            expect(applied).toBe(true);
            expect(harness.group.getActiveEditor()?.getText()).toBe("world");
        } finally {
            await harness.dispose();
        }
    });

    // Regression #194: the selection was only sent on an active editor change, and
    // `activeTextEditor.selection` stayed stuck at (0,0) forever.
    it("расширение видит свежее выделение после движения каретки", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld\nagain" },
            extensions: [extensionFixture("test.editsActiveEditor", "editsActiveEditor.cjs")],
        });
        try {
            await settle();
            const editor = harness.group.getActiveEditor()!;

            editor.viewState.selections = [createSelection(1, 0, 1, 5)];
            await harness.flushRpc(4);
            await settle();

            expect(await harness.commandRegistry.execute("test.readSelection")).toEqual({
                anchorLine: 1,
                anchorCharacter: 0,
                activeLine: 1,
                activeCharacter: 5,
                count: 1,
                isEmpty: false,
            });
        } finally {
            await harness.dispose();
        }
    });

    it("расширение видит несколько кареток (multi-cursor)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld\nagain" },
            extensions: [extensionFixture("test.editsActiveEditor", "editsActiveEditor.cjs")],
        });
        try {
            await settle();
            harness.group.getActiveEditor()!.viewState.selections = [
                createSelection(0, 0, 0, 2),
                createSelection(2, 0, 2, 3),
            ];
            await harness.flushRpc(4);
            await settle();

            const seen = (await harness.commandRegistry.execute("test.readSelection")) as { count: number };
            // maptz bails out on `selections.length > 1`.
            expect(seen.count).toBe(2);
        } finally {
            await harness.dispose();
        }
    });

    // Regression #194: after wrapWithRegion maptz calls a missing command, the RPC
    // is rejected, and Node used to kill the subprocess with all extensions.
    it("необработанный reject в расширении не роняет extension host", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld" },
            extensions: [extensionFixture("test.editsActiveEditor", "editsActiveEditor.cjs")],
        });
        try {
            await settle();
            expect(await harness.commandRegistry.execute("test.fireAndForgetMissingCommand")).toBe("issued");
            await harness.flushRpc(4);
            await settle();

            expect(await harness.commandRegistry.execute("test.visibleCount")).toBe(1);
        } finally {
            await harness.dispose();
        }
    });

    it("window.visibleTextEditors содержит активный редактор", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "a.txt", content: "hello\nworld" },
            extensions: [extensionFixture("test.editsActiveEditor", "editsActiveEditor.cjs")],
        });
        try {
            await settle();
            const count = await harness.commandRegistry.execute("test.visibleCount");
            expect(count).toBe(1);
        } finally {
            await harness.dispose();
        }
    });
});
