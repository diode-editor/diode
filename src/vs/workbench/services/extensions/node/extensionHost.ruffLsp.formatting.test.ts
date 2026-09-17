import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PY_LANGUAGE_SERVICE, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff } from "../../../../../TestUtils/ruffFixture.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatDocumentAction } from "../../../browser/actions/formatActions.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

// Формат Python поверх СТОКОВОГО стека: настоящий ruff.vsix + вшитый
// `ruff server` (documentFormatting и rangeFormatting регистрируются
// клиентом динамически — client/registerCapability). Образец — сьют
// extensionHost.typescriptLsp.formatting.

// Две кривые строки: формат чинит обе (кавычки ruff не трогает — стиль
// по умолчанию double).
const MESSY_PY = 'x  =  1\nprint( "x" )\n';

let installed: IInstalledRuff;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — форматирование от стокового ruff", () => {
    beforeAll(async () => {
        installed = await installRuff();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("formatDocument: правки настоящего ruff-форматтера ложатся в буфер", { timeout: 240_000 }, async () => {
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
        });
        try {
            const mainPath = harness.writeFile("messy.py", MESSY_PY);
            const mainUri = Uri.file(mainPath).toString();
            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            // Шов: дождаться динамической регистрации провайдера и правок сервера.
            const edits = await until("formatting edits от ruff", async () => {
                const source = harness.group.formattingSource;
                if (source === undefined) return null;
                const found: readonly ITextEdit[] | null = await source({
                    uri: mainUri,
                    languageId: "python",
                    text: MESSY_PY,
                    tabSize: 4,
                    insertSpaces: true,
                });
                return found !== null && found.length > 0 ? found : null;
            });
            expect(edits.length).toBeGreaterThan(0);

            // Настоящая команда (как builtinActions в проде) — и текст в буфере.
            const statusBar = {
                addEntry: () => ({ dispose: () => undefined }),
            } as unknown as StatusBarService;
            const accessor = new Container();
            accessor.bind(EditorServiceDIToken, () => harness.group);
            accessor.bind(StatusBarServiceDIToken, () => statusBar);
            registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, formatDocumentAction);

            await harness.commandRegistry.execute("editor.action.formatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe('x = 1\nprint("x")\n');
        } finally {
            await harness.dispose();
        }
    });

    it("range formatting: запрос с range идёт через rangeFormatting-провайдер ruff", { timeout: 240_000 }, async () => {
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
        });
        try {
            const mainPath = harness.writeFile("messy.py", MESSY_PY);
            const mainUri = Uri.file(mainPath).toString();
            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            // Диапазон накрывает только вторую строку — правки обязаны прийти
            // (ruff умеет range formatting) и не выходить за неё.
            const edits = await until("range formatting edits от ruff", async () => {
                const source = harness.group.formattingSource;
                if (source === undefined) return null;
                const found: readonly ITextEdit[] | null = await source({
                    uri: mainUri,
                    languageId: "python",
                    text: MESSY_PY,
                    range: createRange(1, 0, 2, 0),
                    tabSize: 4,
                    insertSpaces: true,
                });
                return found !== null && found.length > 0 ? found : null;
            });
            for (const edit of edits) {
                expect(edit.range.start.line).toBeGreaterThanOrEqual(1);
            }
        } finally {
            await harness.dispose();
        }
    });
});
