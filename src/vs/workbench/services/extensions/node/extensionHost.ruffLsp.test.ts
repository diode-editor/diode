import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, PY_LANGUAGE_SERVICE, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff, LINT_PY, RUFF_ID } from "../../../../../TestUtils/ruffFixture.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// Python-линт «как у пользователя»: НАСТОЯЩИЙ сторонний vsix ruff с open-vsx
// (платформенный, с нативным бинарём), установленный штатным installVsix, на
// настоящем ext-host subprocess'е — ни строчки нашего кода расширения (детали
// и курируемый дефолт importStrategy — src/TestUtils/ruffFixture.ts). Базовый
// сьют: активация, pull-диагностики над живым буфером и их уход после правки.

let installed: IInstalledRuff;

// Vsix приезжает из магазина (см. ruffFixture.ts) — в оффлайне пропускаем.
describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый ruff.vsix (Python-линт, сквозняк)", () => {
    beforeAll(async () => {
        installed = await installRuff();
        expect(installed.registration.id).toBe(RUFF_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("активация без ошибок, F401 приезжает и уходит после несохранённой правки", { timeout: 240_000 }, async () => {
        const published: { resource: string; markers: readonly WireMarker[] }[] = [];
        const outputLines: { level: string; value: string }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
            outputSink: {
                append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                show: () => undefined,
            },
            extensions: [installed.registration],
        });
        try {
            const lintPath = harness.writeFile("lint.py", LINT_PY);
            const lintUri = Uri.file(lintPath).toString();
            const markersFor = (uri: string): readonly WireMarker[] =>
                published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

            harness.group.openFile(lintPath);
            // Ленивая активация ровно тем событием, которое объявляет манифест vsix.
            await harness.host.activateByEvent("onLanguage:python");
            // activate() выжил на нашем стабе — расширение числится активным.
            expect(harness.host.hasExtension(RUFF_ID)).toBe(true);

            // Pull-диагностика от НАСТОЯЩЕГО bundled `ruff server` — readiness-сигнал.
            const f401 = await until("диагностика F401 в lint.py", () => {
                const hit = markersFor(lintUri).find((m) => /F401|unused/.test(`${m.code ?? ""} ${m.message}`));
                return Promise.resolve(hit ?? null);
            });
            // `import sys` — первая строка файла.
            expect(f401.startLine).toBe(0);

            // ИЗМЕНЯЕМЫЙ КОД: удаляем неиспользуемый импорт БЕЗ сохранения на
            // диск — клиент обязан пере-запросить pull-диагностику живого буфера.
            harness.group
                .getActiveEditor()
                ?.applyExternalEdits([createTextEdit(createRange(0, 0, 1, 0), "")], "drop unused import");
            await until("F401 ушла после правки", () =>
                Promise.resolve(
                    markersFor(lintUri).some((m) => /F401|unused/.test(`${m.code ?? ""} ${m.message}`)) ? null : true,
                ),
            );

            // Конвертеры стокового клиента не падали молча (конвенция TS-сьютов).
            const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
            expect(crashes).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
