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
import type { ICoreHover } from "../../../../editor/common/languages/iHoverSource.ts";

// Hover поверх настоящего стороннего basedpyright.vsix (см. basedpyrightFixture):
// стоковый клиент регистрирует hover-провайдер под capability сервера, его
// конвертер зовёт `new code.Hover(...)` / `new code.MarkdownString(...)` —
// падение этих точек видно только на чужом коде, юнит на стабе его не исполняет.

let installed: IInstalledBasedpyright;

describe("ExtensionHost — hover от стокового basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 60_000);

    afterAll(() => {
        installed.dispose();
    });

    it("сигнатура функции под кареткой доезжает markdown-блоком до ядра", { timeout: 240_000 }, async () => {
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
            harness.writeFile("defs.py", DEFS_PY);
            const mainPath = harness.writeFile("main.py", MAIN_PY);
            const mainUri = Uri.file(mainPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:python");

            // Каретка на вызове `greet` — ждём его сигнатуру от настоящего сервера.
            const hovers = await until("hover над `greet`", async () => {
                const source = harness.group.hoverSource;
                if (source === undefined) return null;
                const found: readonly ICoreHover[] = await source({
                    uri: mainUri,
                    languageId: "python",
                    text: MAIN_PY,
                    line: 2,
                    character: 15,
                });
                return found.length > 0 ? found : null;
            });

            // Текст, которого НЕТ в буфере (правило Suggest.md): возвращаемый тип
            // из объявления в другом файле.
            const joined = hovers.flatMap((hover) => hover.contents).join("\n");
            expect(joined).toContain("greet(name: str) -> str");

            const crashes = outputLines.filter((line) => CLIENT_CRASH_PATTERNS.test(line.value));
            expect(crashes).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
