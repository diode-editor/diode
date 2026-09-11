import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { fixAllAction, organizeImportsAction } from "../../../browser/actions/codeActionActions.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import {
    StatusBarServiceDIToken,
    type StatusBarService,
} from "../../../services/statusbar/common/statusBarService.ts";

// Code actions end-to-end с настоящим субпроцессом (#196): настоящая команда
// через commandRegistry → codeActionSource → RPC → провайдер фикстуры →
// resolve/правки через workspace.applyEdit → буфер. Командный путь действия —
// обратный executeCommand в субпроцессе.

function registerCodeActionCommands(harness: {
    commandRegistry: Parameters<typeof registerAction>[0];
    group: unknown;
}): string[] {
    const notices: string[] = [];
    const statusBar = {
        addEntry: (entry: { text: string }) => {
            notices.push(entry.text);
            return { dispose: () => undefined };
        },
    } as unknown as StatusBarService;
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => harness.group as never);
    accessor.bind(StatusBarServiceDIToken, () => statusBar);
    const keybindings = new KeybindingRegistry();
    registerAction(harness.commandRegistry, keybindings, accessor, organizeImportsAction);
    registerAction(harness.commandRegistry, keybindings, accessor, fixAllAction);
    return notices;
}

describe("ExtensionHost — code actions (subprocess)", () => {
    it("organizeImports применяет готовый WorkspaceEdit провайдера, undo откатывает", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "list.txt", content: "pear\napple\nmango" },
            extensions: [extensionFixture("test.providesCodeActions", "providesCodeActions.cjs")],
        });
        try {
            registerCodeActionCommands(harness);
            await settle();

            await harness.commandRegistry.execute("editor.action.organizeImports");
            await settle();

            const editor = harness.group.getActiveEditor();
            expect(editor?.getText()).toBe("apple\nmango\npear");

            editor?.undo();
            expect(editor?.getText()).toBe("pear\napple\nmango");
        } finally {
            await harness.dispose();
        }
    });

    it("fixAll дорезолвливает ленивый edit через codeAction/resolve и применяет", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "list.txt", content: "quiet text" },
            extensions: [extensionFixture("test.providesCodeActions", "providesCodeActions.cjs")],
        });
        try {
            registerCodeActionCommands(harness);
            await settle();

            await harness.commandRegistry.execute("editor.action.fixAll");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("QUIET TEXT");
        } finally {
            await harness.dispose();
        }
    });

    it("командное действие исполняет команду субпроцесса (обратный executeCommand)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "list.txt", content: "note" },
            extensions: [extensionFixture("test.providesCodeActions", "providesCodeActions.cjs")],
        });
        try {
            await settle();
            const source = harness.group.codeActionSource!;
            const actions = await source.provide({
                uri: harness.group.getActiveEditor()!.uri.toString(),
                languageId: "plaintext",
                text: "note",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
                only: "quickfix",
            });
            expect(actions?.map((action) => action.title)).toEqual(["Append marker"]);

            expect(await source.apply(actions![0].id)).toBe(true);
            await settle();
            // Команда действия (test.appendMarker) исполнилась в субпроцессе и
            // дописала маркер через editor.edit — второй RPC-круг.
            expect(harness.group.getActiveEditor()?.getText()).toBe("note!fixed");
        } finally {
            await harness.dispose();
        }
    });

    it("без матчащего вида — честный notice, буфер не тронут", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "list.txt", content: "solo" },
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
        });
        try {
            const notices = registerCodeActionCommands(harness);
            await settle();

            await harness.commandRegistry.execute("editor.action.organizeImports");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("solo");
            expect(notices).toEqual(["No organize imports action for 'plaintext'"]);
        } finally {
            await harness.dispose();
        }
    });
});
