import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    CLIENT_CRASH_PATTERNS,
    DEFS_PY,
    installBasedpyright,
    MAIN_PY,
    PY_LANGUAGE_SERVICE,
    until,
    type IInstalledBasedpyright,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// Python-LSP «как у пользователя»: НАСТОЯЩИЙ сторонний vsix basedpyright с
// open-vsx, установленный штатным installVsix, на настоящем ext-host
// subprocess'е — ни строчки нашего кода расширения (детали и курируемый дефолт
// importStrategy — src/TestUtils/basedpyrightFixture.ts). Базовый сьют:
// активация, цикл диагностик над живым буфером, go to definition.

let installed: IInstalledBasedpyright;

// Vsix приезжает из магазина (см. basedpyrightFixture.ts) — в оффлайне пропускаем.
describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый basedpyright.vsix (Python LSP, сквозняк)", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
        expect(installed.registration.id).toBe("detachhead.basedpyright");
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("активация без ошибок, диагностика приезжает и уходит после несохранённой правки", { timeout: 240_000 }, async () => {
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
            harness.writeFile("defs.py", DEFS_PY);
            const mainPath = harness.writeFile("main.py", MAIN_PY);
            const mainUri = Uri.file(mainPath).toString();
            const markersFor = (uri: string): readonly WireMarker[] =>
                published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

            harness.group.openFile(mainPath);
            // Ленивая активация ровно тем событием, которое объявляет манифест vsix.
            await harness.host.activateByEvent("onLanguage:python");
            // activate() выжил на нашем стабе — расширение числится активным.
            expect(harness.host.hasExtension("detachhead.basedpyright")).toBe(true);

            // Диагностика от НАСТОЯЩЕГО bundled-сервера — она же readiness-сигнал.
            const marker = await until("диагностика 'is not assignable' в main.py", () => {
                const hit = markersFor(mainUri).find((m) => /is not assignable/.test(m.message));
                return Promise.resolve(hit ?? null);
            });
            expect(marker.startLine).toBe(2);

            // ИЗМЕНЯЕМЫЙ КОД: чиним аннотацию без сохранения на диск — сервер
            // обязан видеть живой буфер (didOpen/didChange + цикл диагностик).
            harness.group.getActiveEditor()?.applyExternalEdits(
                [createTextEdit(createRange(2, 7, 2, 10), "str")],
                "fix type",
            );
            await until("диагностика ушла после фикса", () =>
                Promise.resolve(markersFor(mainUri).some((m) => /is not assignable/.test(m.message)) ? null : true),
            );

            // Конвертеры стокового клиента не падали молча (конвенция TS-сьютов).
            const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
            expect(crashes).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("go to definition: с вызова greet в объявление в defs.py", { timeout: 240_000 }, async () => {
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
        });
        try {
            const defsPath = harness.writeFile("defs.py", DEFS_PY);
            const mainPath = harness.writeFile("main.py", MAIN_PY);
            const mainUri = Uri.file(mainPath).toString();
            const defsUri = Uri.file(defsPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            // Каретка на вызове `greet` (строка 2, внутри имени) → объявление.
            const locations = await until("definition вызова greet", async () => {
                const source = harness.group.definitionSource;
                if (source === undefined) return null;
                const found = await source({
                    uri: mainUri,
                    languageId: "python",
                    text: MAIN_PY,
                    line: 2,
                    character: 15,
                });
                return found.length > 0 ? found : null;
            });
            expect(locations[0].uri).toBe(defsUri);
            // `def greet(...)` — имя начинается в колонке 4 первой строки.
            expect(locations[0].range.start).toMatchObject({ line: 0, character: 4 });
        } finally {
            await harness.dispose();
        }
    });
});
