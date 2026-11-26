import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createCursorSelection, createSelection } from "../../../../editor/common/core/iSelection.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";
import { defaultTypeAction, typeAction } from "../../../browser/actions/editorEditActions.ts";
import { EditorServiceDIToken } from "../../editor/common/editorService.ts";
import { LanguageConfigurationService } from "../../language/common/languageConfigurationService.ts";

const FIXTURE = extensionFixture("test.typeCommand", "typeCommand.cjs");

describe("ExtensionHost — the type command (subprocess)", () => {
    let harness: IExtensionHarness;
    let focused: boolean;

    const open = async (content: string): Promise<void> => {
        const commandRegistry = new CommandRegistry();
        const languageConfigurations = new LanguageConfigurationService(
            { readText: () => Promise.reject(new Error("no assets")) } as never,
            { getLanguage: () => undefined },
            NULL_LOGGER,
        );
        harness = await createExtensionTestHarness({
            initialFile: { name: "doc.txt", content },
            extensions: [FIXTURE],
            commandRegistry,
            languageConfigurations,
            editorLanguageConfigurations: languageConfigurations,
        });
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => harness.group);
        accessor.bind(ContextKeyServiceDIToken, () => ({ evaluate: () => focused }) as never);
        const keybindings = new KeybindingRegistry();
        registerAction(commandRegistry, keybindings, accessor, typeAction);
        registerAction(commandRegistry, keybindings, accessor, defaultTypeAction);
        await settle();
    };

    const execute = (id: string, ...args: unknown[]): Promise<unknown> =>
        Promise.resolve(harness.commandRegistry.execute(`test.type.${id}`, ...args));
    const editor = () => {
        const pane = harness.group.getActiveEditor();
        if (pane === null) throw new Error("no active editor");
        return pane;
    };
    const cursorAt = (line: number, character: number): void => {
        editor().viewState.selections = [createCursorSelection(line, character)];
    };

    beforeEach(() => {
        focused = true;
    });

    afterEach(async () => {
        await harness.dispose();
    });

    it("[api:commands.executeCommand] type inserts the text at the cursor and moves it", async () => {
        await open("ab");
        cursorAt(0, 1);
        await execute("exec", { text: "XY" });
        expect(editor().getText()).toBe("aXYb");
        expect(editor().viewState.selections[0].active).toEqual({ line: 0, character: 3 });
    });

    it("[api:commands.executeCommand] type replaces the selection and goes to every cursor", async () => {
        await open("one\ntwo");
        editor().viewState.selections = [createCursorSelection(0, 3), createSelection(1, 0, 1, 3)];
        await execute("exec", { text: "!" });
        expect(editor().getText()).toBe("one!\n!");
    });

    it("[api:commands.executeCommand] a line break keeps the indent, as Enter", async () => {
        await open("    plain");
        cursorAt(0, 9);
        await execute("exec", { source: "keyboard", text: "\n" });
        await execute("exec", { text: "two" });
        expect(editor().getText()).toBe("    plain\n    two");
    });

    it("[api:commands.executeCommand] [api:languages.setLanguageConfiguration] auto-close and onEnterRules of the language apply", async () => {
        await open("> quote");
        await execute("setRules");
        await settle();
        cursorAt(0, 7);
        await execute("exec", { text: "\n" });
        expect(editor().getText()).toBe("> quote\n> ");
        await execute("exec", { text: "(" });
        expect(editor().getText()).toBe("> quote\n> ()");
    });

    it("[api:commands.executeCommand] default:type does the same", async () => {
        await open("ab");
        cursorAt(0, 2);
        await execute("execDefault", { text: "c" });
        expect(editor().getText()).toBe("abc");
    });

    it.each([
        ["no argument", []],
        ["no text", [{}]],
        ["a text of another type", [{ text: 1 }]],
    ])("[api:commands.executeCommand] %s: nothing happens, no error", async (_name, args) => {
        await open("ab");
        await expect(execute("exec", ...args)).resolves.toBeUndefined();
        expect(editor().getText()).toBe("ab");
    });

    it("[api:commands.executeCommand] no editor in focus: nothing happens, no error", async () => {
        await open("ab");
        focused = false;
        await expect(execute("exec", { text: "c" })).resolves.toBeUndefined();
        expect(editor().getText()).toBe("ab");
    });

    it("[api:commands.registerCommand] an extension overrides type; disposing it brings the built-in back", async () => {
        await open("ab");
        cursorAt(0, 2);
        await execute("override");
        await execute("exec", { text: "own" });
        // The other route: through the host registry, as a keybinding or another extension would call it.
        await harness.commandRegistry.execute("type", { text: "host" });
        expect(await execute("received")).toEqual([{ text: "own" }, { text: "host" }]);
        expect(editor().getText()).toBe("ab");

        await execute("execDefault", { text: "d" });
        expect(editor().getText()).toBe("abd");

        await execute("disposeOverride");
        await execute("exec", { text: "e" });
        expect(editor().getText()).toBe("abde");
    });
});
