import * as fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PY_LANGUAGE_SERVICE, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff, LINT_PY } from "../../../../../TestUtils/ruffFixture.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";

// onSave поверх СТОКОВОГО стека (#196, хвост): настоящий ruff.vsix + вшитый
// `ruff server`. `editor.codeActionsOnSave: {"source.fixAll": true}` при
// сохранении прогоняет `source.fixAll.ruff` (иерархический матч), а
// `editor.formatOnSave` — формат от того же сервера; на диск уходит уже
// поправленный текст. Герметичный контракт пайплайна —
// editorService.onSave.test.ts; здесь — что его закрывает стоковое расширение.

let installed: IInstalledRuff;

function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, defaultValue?: T): T | undefined {
            return key in values ? (values[key] as T) : defaultValue;
        },
    };
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — сохранение с onSave-настройками и стоковым ruff", () => {
    beforeAll(async () => {
        installed = await installRuff();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    /** Харнесс с настройками ядра + открытый lint.py + активация ruff. */
    async function openLintFile(configuration: Record<string, unknown>): Promise<{
        harness: IExtensionHarness;
        lintPath: string;
        lintUri: string;
    }> {
        const harness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
            configurationService: stubConfigurationService(configuration),
        });
        const lintPath = harness.writeFile("lint.py", LINT_PY);
        harness.group.openFile(lintPath);
        await harness.host.activateByEvent("onLanguage:python");
        return { harness, lintPath, lintUri: Uri.file(lintPath).toString() };
    }

    it(
        "codeActionsOnSave source.fixAll: save удаляет неиспользуемый импорт в буфере и на диске",
        { timeout: 240_000 },
        async () => {
            const { harness, lintPath, lintUri } = await openLintFile({
                "editor.codeActionsOnSave": { "source.fixAll": true },
            });
            try {
                // Прогрев: дождаться, пока сервер начнёт отдавать fixAll-действия,
                // иначе первый save попадёт в холодный старт и его 5с-таймауты.
                await until("source.fixAll action от ruff", async () => {
                    const source = harness.group.codeActionSource;
                    if (source === undefined) return null;
                    const actions = await source.provide({
                        uri: lintUri,
                        languageId: "python",
                        text: LINT_PY,
                        range: createRange(0, 0, 4, 17),
                        only: "source.fixAll",
                    });
                    return actions !== null && actions.length > 0 ? actions : null;
                });

                const outcome = await harness.group.getActiveEditor()!.save();

                expect(outcome).toBe("saved");
                const buffer = harness.group.getActiveEditor()?.getText() ?? "";
                expect(buffer).not.toContain("import sys");
                expect(buffer).toContain("import os");
                // Ключевой контракт onSave: на диск ушёл УЖЕ поправленный текст.
                expect(fs.readFileSync(lintPath, "utf-8")).toBe(buffer);
            } finally {
                await harness.dispose();
            }
        },
    );

    it("formatOnSave: save прогоняет формат ruff, на диске отформатированный текст", { timeout: 240_000 }, async () => {
        const { harness, lintPath, lintUri } = await openLintFile({ "editor.formatOnSave": true });
        try {
            // Прогрев: формат регистрируется клиентом динамически — дождаться правок.
            await until("formatting edits от ruff", async () => {
                const source = harness.group.formattingSource;
                if (source === undefined) return null;
                const found: readonly ITextEdit[] | null = await source({
                    uri: lintUri,
                    languageId: "python",
                    text: LINT_PY,
                    tabSize: 4,
                    insertSpaces: true,
                });
                return found !== null && found.length > 0 ? found : null;
            });

            const outcome = await harness.group.getActiveEditor()!.save();

            expect(outcome).toBe("saved");
            const buffer = harness.group.getActiveEditor()?.getText() ?? "";
            // Ruff-формат чинит лишние пробелы: `print( "x" )` → `print("x")`.
            expect(buffer).toContain('print("x")');
            expect(fs.readFileSync(lintPath, "utf-8")).toBe(buffer);
        } finally {
            await harness.dispose();
        }
    });
});
