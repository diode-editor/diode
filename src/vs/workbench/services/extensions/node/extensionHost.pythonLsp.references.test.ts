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
import { Uri } from "../../../../base/common/uri.ts";

// Find All References поверх настоящего стороннего basedpyright.vsix (см.
// basedpyrightFixture): ссылки на символ собираются из ДВУХ файлов — объявление
// в defs.py и вызов в main.py.

let installed: IInstalledBasedpyright;

describe("ExtensionHost — references от стокового basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 60_000);

    afterAll(() => {
        installed.dispose();
    });

    it("ссылки на greet приходят из обоих файлов (включая объявление)", { timeout: 240_000 }, async () => {
        const outputLines: { level: string; value: string }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            outputSink: {
                append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                show: () => undefined,
            },
            extensions: [installed.registration],
        });
        try {
            const defsPath = harness.writeFile("defs.py", DEFS_PY);
            const mainPath = harness.writeFile("main.py", MAIN_PY);
            const mainUri = Uri.file(mainPath).toString();
            const defsUri = Uri.file(defsPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            // Каретка на вызове `greet` → ссылки с includeDeclaration (как VS Code).
            const references = await until("references вызова greet", async () => {
                const source = harness.group.referenceSource;
                if (source === undefined) return null;
                const found = await source({
                    uri: mainUri,
                    languageId: "python",
                    text: MAIN_PY,
                    line: 2,
                    character: 15,
                    includeDeclaration: true,
                });
                // Ждём, пока сервер соберёт ОБА файла (первым может прийти только текущий).
                const uris = new Set(found.map((ref) => ref.uri));
                return uris.has(defsUri) && uris.has(mainUri) ? found : null;
            });

            // Объявление в defs.py — имя `greet` в колонке 4 первой строки.
            const declaration = references.find((ref) => ref.uri === defsUri);
            expect(declaration?.range.start).toMatchObject({ line: 0, character: 4 });
            // Вызов и импорт в main.py.
            const inMain = references.filter((ref) => ref.uri === mainUri);
            expect(inMain.length).toBeGreaterThanOrEqual(2);

            const crashes = outputLines.filter((line) => CLIENT_CRASH_PATTERNS.test(line.value));
            expect(crashes).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
