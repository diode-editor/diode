import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatDocumentAction, formatSelectionAction } from "../../../contrib/format/browser/formatActions.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { EditorServiceDIToken } from "../../editor/common/editorService.ts";

function registerFormatActions(harness: {
    commandRegistry: Parameters<typeof registerAction>[0];
    group: unknown;
    languageFeatures: ILanguageFeaturesService;
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
    accessor.bind(LanguageFeaturesServiceDIToken, () => harness.languageFeatures);
    accessor.bind(StatusBarServiceDIToken, () => statusBar);
    const keybindings = new KeybindingRegistry();
    registerAction(harness.commandRegistry, keybindings, accessor, formatDocumentAction);
    registerAction(harness.commandRegistry, keybindings, accessor, formatSelectionAction);
    return notices;
}

describe("ExtensionHost — editor.action.formatDocument (subprocess)", () => {
    it("the command formats the document with the provider's edits, undo reverts in one step", async () => {
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

    it("formatSelection touches only the selection (range provider)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "doc.txt", content: "alpha    beta\ngamma  delta" },
            extensions: [extensionFixture("test.providesFormatting", "providesFormatting.cjs")],
        });
        try {
            registerFormatActions(harness);
            await settle();

            harness.group.getActiveEditor()!.viewState.selections = [createSelection(1, 0, 1, 12)];
            await harness.commandRegistry.execute("editor.action.formatSelection");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("alpha    beta\ngamma delta");
        } finally {
            await harness.dispose();
        }
    });

    it("executeCommand from the subprocess (the maptz.regionfolder path) resolves and formats", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "doc.txt", content: "x    y" },
            extensions: [extensionFixture("test.providesFormatting", "providesFormatting.cjs")],
        });
        try {
            registerFormatActions(harness);
            await settle();

            await harness.commandRegistry.execute("test.invokeFormatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("x y");
        } finally {
            await harness.dispose();
        }
    });

    it("without a provider: `no formatter` in the status bar, the buffer is untouched", async () => {
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
