import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    provideCodeActions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import {
    fixAllAction,
    organizeImportsAction,
    quickFixAction,
} from "../../../contrib/codeAction/browser/codeActionActions.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { EditorServiceDIToken } from "../../editor/common/editorService.ts";

function registerCodeActionCommands(
    harness: {
        commandRegistry: Parameters<typeof registerAction>[0];
        group: unknown;
        languageFeatures: ILanguageFeaturesService;
    },
    pickLabel?: string,
): string[] {
    const notices: string[] = [];
    const statusBar = {
        addEntry: (entry: { text: string }) => {
            notices.push(entry.text);
            return { dispose: () => undefined };
        },
    } as unknown as StatusBarService;
    const quickInput = {
        quickPick: (opts: { items: readonly { label: string }[] }) =>
            Promise.resolve(pickLabel === undefined ? undefined : opts.items.find((item) => item.label === pickLabel)),
    } as unknown as QuickInputService;
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => harness.group as never);
    accessor.bind(LanguageFeaturesServiceDIToken, () => harness.languageFeatures);
    accessor.bind(StatusBarServiceDIToken, () => statusBar);
    accessor.bind(QuickInputServiceDIToken, () => quickInput);
    const keybindings = new KeybindingRegistry();
    registerAction(harness.commandRegistry, keybindings, accessor, organizeImportsAction);
    registerAction(harness.commandRegistry, keybindings, accessor, fixAllAction);
    registerAction(harness.commandRegistry, keybindings, accessor, quickFixAction);
    return notices;
}

describe("ExtensionHost — code actions (subprocess)", () => {
    it("organizeImports applies the provider's ready WorkspaceEdit, undo reverts it", async () => {
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

    it("fixAll resolves a lazy edit through codeAction/resolve and applies it", async () => {
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

    it("quickFix menu: the picked action goes the whole way to the buffer", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "list.txt", content: "note" },
            extensions: [extensionFixture("test.providesCodeActions", "providesCodeActions.cjs")],
        });
        try {
            registerCodeActionCommands(harness, "Append marker");
            await settle();

            await harness.commandRegistry.execute("editor.action.quickFix");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("note!fixed");
        } finally {
            await harness.dispose();
        }
    });

    it("a command action runs the subprocess command (reverse executeCommand)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "list.txt", content: "note" },
            extensions: [extensionFixture("test.providesCodeActions", "providesCodeActions.cjs")],
        });
        try {
            await settle();
            const uri = harness.group.getActiveEditor()!.uri.toString();
            const actions = await provideCodeActions(harness, {
                uri,
                languageId: "plaintext",
                versionId: documentVersion(harness, uri),
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
                only: "quickfix",
            });
            expect(actions.map((action) => action.title)).toEqual(["Append marker"]);

            expect(await harness.host.applyCodeAction(actions[0].id)).toBe(true);
            await settle();
            expect(harness.group.getActiveEditor()?.getText()).toBe("note!fixed");
        } finally {
            await harness.dispose();
        }
    });

    it("without a matching kind: a plain notice, the buffer is untouched", async () => {
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
