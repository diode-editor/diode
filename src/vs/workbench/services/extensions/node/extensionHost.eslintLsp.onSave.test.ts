import * as fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    ensureEslintLibrary,
    ESLINT_FLAT_CONFIG,
    type IInstalledEslint,
    installEslint,
    JS_LANGUAGE_SERVICE,
    linkEslintLibrary,
    LINT_JS,
} from "../../../../../TestUtils/eslintFixture.ts";
import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";

// Флагманский сценарий eslint (#196 + #310 поверх стока): настоящий
// vscode-eslint.vsix, `editor.codeActionsOnSave: {"source.fixAll": true}` —
// сохранение прогоняет `source.fixAll.eslint` иерархическим матчем, на диск
// уходит уже поправленный текст. Герметичный контракт пайплайна —
// editorService.onSave.test.ts; здесь — что его закрывает стоковое расширение.

let installed: IInstalledEslint;
let eslintNodeModules: string;

function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, defaultValue?: T): T | undefined {
            return key in values ? (values[key] as T) : defaultValue;
        },
    };
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — сохранение с codeActionsOnSave и стоковым eslint", () => {
    beforeAll(async () => {
        installed = await installEslint();
        eslintNodeModules = ensureEslintLibrary();
    }, 300_000);

    afterAll(() => {
        installed.dispose();
    });

    it("codeActionsOnSave source.fixAll: save чинит лишнюю `;` в буфере и на диске", { timeout: 240_000 }, async () => {
        const harness = await createExtensionTestHarness({
            languageService: JS_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
            configurationService: stubConfigurationService({
                "editor.codeActionsOnSave": { "source.fixAll": true },
            }),
        });
        try {
            linkEslintLibrary(harness.tmpDir, eslintNodeModules);
            harness.writeFile("eslint.config.mjs", ESLINT_FLAT_CONFIG);
            const lintPath = harness.writeFile("lint.js", LINT_JS);
            const lintUri = Uri.file(lintPath).toString();
            harness.group.openFile(lintPath);
            await harness.host.activateByEvent("onStartupFinished");

            // Прогрев: дождаться, пока сервер начнёт отдавать fixAll-действия,
            // иначе первый save попадёт в холодный старт и его 5с-таймауты.
            await until("source.fixAll action от eslint", async () => {
                const source = harness.group.codeActionSource;
                if (source === undefined) return null;
                const actions = await source.provide({
                    uri: lintUri,
                    languageId: "javascript",
                    text: LINT_JS,
                    range: createRange(0, 0, 0, 18),
                    only: "source.fixAll",
                });
                return actions !== null && actions.length > 0 ? actions : null;
            });

            const outcome = await harness.group.getActiveEditor()!.save();

            expect(outcome).toBe("saved");
            const buffer = harness.group.getActiveEditor()?.getText() ?? "";
            // Safe-фикс no-extra-semi применён, no-unused-vars фикса не имеет.
            expect(buffer).toBe("const unused = 1;\n");
            // Ключевой контракт onSave: на диск ушёл УЖЕ поправленный текст.
            expect(fs.readFileSync(lintPath, "utf-8")).toBe(buffer);
        } finally {
            await harness.dispose();
        }
    });
});
