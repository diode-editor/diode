import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    CLIENT_CRASH_PATTERNS,
    DEFS_PY,
    installBasedpyright,
    MARKETPLACE_OFFLINE,
    PY_LANGUAGE_SERVICE,
    until,
    type IInstalledBasedpyright,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

// Signature help поверх настоящего стороннего basedpyright.vsix (см.
// basedpyrightFixture): конвертер клиента конструирует SignatureHelp/
// SignatureInformation/ParameterInformation на каждый ответ — чужой код,
// проверяемый только сквозняком.

// Каретка внутри скобок вызова greet( — как после набора «(».
const MAIN_PY = "from defs import greet\n\ngreet(\n";

let installed: IInstalledBasedpyright;

// Vsix приезжает из магазина (см. basedpyrightFixture.ts) — в оффлайне пропускаем.
describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — signature help от стокового basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("сигнатура greet с активным параметром доезжает до ядра", { timeout: 240_000 }, async () => {
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

            const help = await until("signature help внутри greet(", async () => {
                const source = harness.group.signatureHelpSource;
                if (source === undefined) return null;
                const found = await source({
                    uri: mainUri,
                    languageId: "python",
                    text: MAIN_PY,
                    line: 2,
                    character: 6,
                    triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
                    triggerCharacter: "(",
                    isRetrigger: false,
                });
                return found !== null && found.signatures.length > 0 ? found : null;
            });

            // Текст, которого нет в буфере: полная сигнатура из объявления.
            expect(help.signatures[0].label).toContain("(name: str) -> str");
            expect(help.signatures[0].parameters.length).toBe(1);
            expect(help.activeParameter).toBe(0);

            const crashes = outputLines.filter((line) => CLIENT_CRASH_PATTERNS.test(line.value));
            expect(crashes).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
