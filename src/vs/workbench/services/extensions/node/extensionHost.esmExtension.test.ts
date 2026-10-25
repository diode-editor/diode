import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    EXTENSION_FIXTURES_DIR,
    extensionFixture,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatDocumentAction } from "../../../contrib/format/browser/formatActions.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { EditorServiceDIToken } from "../../editor/common/editorService.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/**
 * The subprocess runs under tsx, like `npm start`: the tsx ESM hook sends the unfamiliar
 * `"vscode"` to the CJS resolver, so a missing ESM hook of ours would not show here. The
 * ESM load path itself is proven on the built binary by e2e/prettierFormat.test.ts; this
 * file checks the API surface an ESM extension sees once loaded.
 */

function esmFixture(): IExtensionRegistration {
    return {
        id: "test.esmExtension",
        manifest: { name: "esmExtension", publisher: "test", version: "0.0.1", type: "module" },
        mainPath: path.join(EXTENSION_FIXTURES_DIR, "esmExtension", "extension.js"),
    };
}

function registerFormatAction(harness: {
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
    registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, formatDocumentAction);
    return notices;
}

describe("ExtensionHost — ESM extension (subprocess without tsx)", () => {
    it("activates, sees `vscode` and returns exports", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [esmFixture()],
        });
        try {
            await settle();
            expect(await harness.commandRegistry.execute("test.esm.ping")).toBe("pong from esm");
        } finally {
            await harness.dispose();
        }
    });

    it("its formatting provider edits the buffer (via positionAt)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "doc.txt", content: "alpha    beta\ngamma  delta" },
            extensions: [esmFixture()],
        });
        try {
            registerFormatAction(harness);
            await settle();

            await harness.commandRegistry.execute("editor.action.formatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("alpha beta\ngamma delta");
        } finally {
            await harness.dispose();
        }
    });

    it("a CJS extension in the same mode is not broken by the ESM hook", async () => {
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.registersCommand", "registersCommand.cjs")],
        });
        try {
            await settle();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });
});
