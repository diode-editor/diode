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
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/**
 * ESM-расширения (`"type": "module"` в манифесте) — настоящий субпроцесс.
 *
 * Субпроцесс здесь поднимается БЕЗ tsx (`subprocessLoader: "node"`): tsx
 * регистрирует свой ESM-хук, который уводит незнакомый ему `"vscode"` в
 * CJS-резолвер — и тем самым прячет ровно то, что проверяет этот файл. На
 * родном loader'е Node без нашего `module.registerHooks` активация падает с
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'vscode'`.
 *
 * Фикстура — каталог со своим `package.json` (`"type": "module"`), то есть та же
 * форма, в которой ESM-расширение приезжает из магазина (`esbenp.prettier-vscode`
 * 12.x).
 */

function esmFixture(): IExtensionRegistration {
    return {
        id: "test.esmExtension",
        manifest: { name: "esmExtension", publisher: "test", version: "0.0.1", type: "module" },
        mainPath: path.join(EXTENSION_FIXTURES_DIR, "esmExtension", "extension.js"),
    };
}

/** Регистрирует настоящую команду формата (как WORKBENCH_ACTIONS в проде). */
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

describe("ExtensionHost — ESM-расширение (subprocess без tsx)", () => {
    it("активируется, видит `vscode` и отдаёт exports", async () => {
        const harness = await createExtensionTestHarness({
            subprocessLoader: "node",
            extensions: [esmFixture()],
        });
        try {
            await settle();
            // Команда, зарегистрированная из ESM-модуля, доехала до host-реестра —
            // значит `import { commands } from "vscode"` отработал.
            expect(await harness.commandRegistry.execute("test.esm.ping")).toBe("pong from esm");
        } finally {
            await harness.dispose();
        }
    });

    it("его провайдер форматирования правит буфер (через positionAt)", async () => {
        const harness = await createExtensionTestHarness({
            subprocessLoader: "node",
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

    it("CJS-расширение в том же режиме не сломано ESM-хуком", async () => {
        const harness = await createExtensionTestHarness({
            subprocessLoader: "node",
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
