import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    CLIENT_CRASH_PATTERNS,
    DEFS_PY,
    type IInstalledBasedpyright,
    installBasedpyright,
    MAIN_PY,
    PY_LANGUAGE_SERVICE,
    until,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ICoreHover } from "../../../../editor/common/languages/iHoverSource.ts";

// The stock client's converter calls `new code.Hover(...)`; its failure shows up
// only on foreign code, a unit test against the stub never runs it.

let installed: IInstalledBasedpyright;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — hover от стокового basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 120_000);

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

            const hovers = await until("hover над `greet`", async () => {
                const found: readonly ICoreHover[] = await provideHovers(harness, {
                    uri: mainUri,
                    languageId: "python",
                    versionId: documentVersion(harness, mainUri),
                    line: 2,
                    character: 15,
                });
                return found.length > 0 ? found : null;
            });

            // The text is NOT in the buffer (Suggest.md rule): the type comes from a declaration in another file.
            const joined = hovers.flatMap((hover) => hover.contents).join("\n");
            expect(joined).toContain("greet(name: str) -> str");

            const crashes = outputLines.filter((line) => CLIENT_CRASH_PATTERNS.test(line.value));
            expect(crashes).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
