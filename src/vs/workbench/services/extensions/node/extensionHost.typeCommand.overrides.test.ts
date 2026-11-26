import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { defaultTypeAction, typeAction } from "../../../browser/actions/editorEditActions.ts";
import { EditorServiceDIToken } from "../../editor/common/editorService.ts";

const FIXTURE = extensionFixture("test.typeCommandTwoOverrides", "typeCommandTwoOverrides.cjs");

describe("ExtensionHost — two overrides of the type command (subprocess)", () => {
    let harness: IExtensionHarness;

    afterEach(async () => {
        await harness.dispose();
    });

    it("[api:commands.registerCommand] disposing the second override leaves the first one in place", async () => {
        const commandRegistry = new CommandRegistry();
        harness = await createExtensionTestHarness({
            initialFile: { name: "doc.txt", content: "ab" },
            extensions: [FIXTURE],
            commandRegistry,
        });
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => harness.group);
        accessor.bind(ContextKeyServiceDIToken, () => ({ evaluate: () => true }) as never);
        const keybindings = new KeybindingRegistry();
        registerAction(commandRegistry, keybindings, accessor, typeAction);
        registerAction(commandRegistry, keybindings, accessor, defaultTypeAction);
        await settle();

        const execute = (id: string, ...args: unknown[]): Promise<unknown> =>
            Promise.resolve(commandRegistry.execute(`test.twoOverrides.${id}`, ...args));

        await execute("register", "first");
        await execute("register", "second");
        await execute("dispose", "second");
        await execute("exec", "x");

        // The first override still owns `type`: the text reaches it and not the document.
        expect(await execute("received")).toEqual(["first:x"]);
        expect(harness.group.getActiveEditor()?.getText()).toBe("ab");
    });
});
