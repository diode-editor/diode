import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    ensureEslintLibrary,
    ESLINT_FLAT_CONFIG,
    ESLINT_ID,
    type IInstalledEslint,
    installEslint,
    JS_LANGUAGE_SERVICE,
    linkEslintLibrary,
    LINT_JS,
} from "../../../../../TestUtils/eslintFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// JS-линт «как у пользователя»: НАСТОЯЩИЙ сторонний vsix vscode-eslint,
// установленный штатным installVsix, на настоящем ext-host subprocess'е — ни
// строчки нашего кода расширения (обвязка — src/TestUtils/eslintFixture.ts).
// Библиотеку eslint сервер расширения резолвит из node_modules воркспейса —
// фикстура доносит её симлинком. Базовый сьют: активация по onStartupFinished,
// push-диагностики над живым буфером и их пересчёт после несохранённой правки.

let installed: IInstalledEslint;
let eslintNodeModules: string;

// Vsix и npm-пакет eslint приезжают по сети — в оффлайне пропускаем.
describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый vscode-eslint.vsix (JS-линт, сквозняк)", () => {
    beforeAll(async () => {
        installed = await installEslint();
        expect(installed.registration.id).toBe(ESLINT_ID);
        eslintNodeModules = ensureEslintLibrary();
    }, 300_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "активация без ошибок, no-extra-semi приезжает и уходит после несохранённой правки",
        { timeout: 240_000 },
        async () => {
            const published: { resource: string; markers: readonly WireMarker[] }[] = [];
            const outputLines: { level: string; value: string }[] = [];
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: JS_LANGUAGE_SERVICE,
                activateEvents: [],
                diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                outputSink: {
                    append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                    show: () => undefined,
                },
                extensions: [installed.registration],
            });
            try {
                linkEslintLibrary(harness.tmpDir, eslintNodeModules);
                harness.writeFile("eslint.config.mjs", ESLINT_FLAT_CONFIG);
                const lintPath = harness.writeFile("lint.js", LINT_JS);
                const lintUri = Uri.file(lintPath).toString();
                const markersFor = (uri: string): readonly WireMarker[] =>
                    published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

                harness.group.openFile(lintPath);
                // Ленивая активация ровно тем событием, которое объявляет манифест vsix.
                await harness.host.activateByEvent("onStartupFinished");
                // activate() выжил на нашем стабе — расширение числится активным.
                expect(harness.host.hasExtension(ESLINT_ID)).toBe(true);

                // Push-диагностика от НАСТОЯЩЕГО eslintServer — readiness-сигнал.
                const extraSemi = await until("диагностика no-extra-semi в lint.js", () => {
                    const hit = markersFor(lintUri).find((m) => (m.code ?? "") === "no-extra-semi");
                    return Promise.resolve(hit ?? null);
                });
                expect(extraSemi.startLine).toBe(0);
                expect(markersFor(lintUri).some((m) => (m.code ?? "") === "no-unused-vars")).toBe(true);

                // ИЗМЕНЯЕМЫЙ КОД: убираем лишнюю `;` БЕЗ сохранения на диск —
                // eslint.run=onType обязан пересчитать диагностику живого буфера.
                harness.group
                    .getActiveEditor()
                    ?.applyExternalEdits([createTextEdit(createRange(0, 17, 0, 18), "")], "drop extra semi");
                await until("no-extra-semi ушла после правки", () =>
                    Promise.resolve(markersFor(lintUri).some((m) => (m.code ?? "") === "no-extra-semi") ? null : true),
                );
                // Пересчёт, а не сброс: непофиксенная no-unused-vars осталась.
                expect(markersFor(lintUri).some((m) => (m.code ?? "") === "no-unused-vars")).toBe(true);

                // Конвертеры стокового клиента не падали молча (конвенция TS-сьютов).
                const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
                expect(crashes).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
