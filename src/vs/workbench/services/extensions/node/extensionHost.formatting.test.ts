import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatDocumentAction, formatSelectionAction } from "../../../browser/actions/formatActions.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import {
    StatusBarServiceDIToken,
    type StatusBarService,
} from "../../../services/statusbar/common/statusBarService.ts";

// Команды форматирования end-to-end с настоящим субпроцессом: настоящая
// команда через commandRegistry → EditorService.formattingSource → host →
// RPC → провайдер фикстуры → правки в буфере (#196, DoD-гейт «тест гоняет
// настоящую команду и сверяет текст документа»).

/** Регистрирует НАСТОЯЩИЕ формат-команды в реестре харнесса (как builtinActions в проде). */
function registerFormatActions(harness: {
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
    registerAction(harness.commandRegistry, keybindings, accessor, formatDocumentAction);
    registerAction(harness.commandRegistry, keybindings, accessor, formatSelectionAction);
    return notices;
}

describe("ExtensionHost — editor.action.formatDocument (subprocess)", () => {
    it("команда форматирует документ правками провайдера, undo откатывает одним шагом", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "doc.txt", content: "alpha    beta\ngamma  delta" },
            extensions: [extensionFixture("test.providesFormatting", "providesFormatting.cjs")],
        });
        try {
            registerFormatActions(harness);
            await settle();

            await harness.commandRegistry.execute("editor.action.formatDocument");
            await settle();

            const editor = harness.group.getActiveEditor();
            expect(editor?.getText()).toBe("alpha beta\ngamma delta");

            editor?.undo();
            expect(editor?.getText()).toBe("alpha    beta\ngamma  delta");
        } finally {
            await harness.dispose();
        }
    });

    it("formatSelection трогает только выделение (range-провайдер)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "doc.txt", content: "alpha    beta\ngamma  delta" },
            extensions: [extensionFixture("test.providesFormatting", "providesFormatting.cjs")],
        });
        try {
            registerFormatActions(harness);
            await settle();

            // Выделена только вторая строка — первая должна остаться как есть.
            harness.group.getActiveEditor()!.viewState.selections = [createSelection(1, 0, 1, 12)];
            await harness.commandRegistry.execute("editor.action.formatSelection");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("alpha    beta\ngamma delta");
        } finally {
            await harness.dispose();
        }
    });

    it("executeCommand из субпроцесса (путь maptz.regionfolder) резолвится и форматирует", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "doc.txt", content: "x    y" },
            extensions: [extensionFixture("test.providesFormatting", "providesFormatting.cjs")],
        });
        try {
            registerFormatActions(harness);
            await settle();

            // До #196 этот вызов отклонялся с `command "editor.action.formatDocument"
            // not found` — здесь он обязан резолвиться и дойти до буфера.
            await harness.commandRegistry.execute("test.invokeFormatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("x y");
        } finally {
            await harness.dispose();
        }
    });

    it("без провайдера — «нет форматтера» в статус-баре, буфер не тронут", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "doc.txt", content: "x    y" },
            extensions: [extensionFixture("test.noop", "noopExtension.cjs")],
        });
        try {
            const notices = registerFormatActions(harness);
            await settle();

            await harness.commandRegistry.execute("editor.action.formatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("x    y");
            expect(notices).toEqual(["No formatter for 'plaintext' installed"]);
        } finally {
            await harness.dispose();
        }
    });
});
