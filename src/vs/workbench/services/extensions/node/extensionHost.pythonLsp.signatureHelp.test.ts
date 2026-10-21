import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
    CLIENT_CRASH_PATTERNS,
    DEFS_PY,
    type IInstalledBasedpyright,
    installBasedpyright,
    PY_LANGUAGE_SERVICE,
    until,
} from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideSignatureHelp,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

// Cursor inside the parentheses of the greet( call, as after typing "(".
const MAIN_PY = "from defs import greet\n\ngreet(\n";

let installed: IInstalledBasedpyright;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — signature help from the stock basedpyright", () => {
    beforeAll(async () => {
        installed = await installBasedpyright();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it("the greet signature with the active parameter reaches the core", { timeout: 240_000 }, async () => {
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

            const help = await until("signature help inside greet(", async () => {
                const found = await provideSignatureHelp(harness, {
                    uri: mainUri,
                    languageId: "python",
                    versionId: documentVersion(harness, mainUri),
                    line: 2,
                    character: 6,
                    triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
                    triggerCharacter: "(",
                    isRetrigger: false,
                });
                return found !== null && found.signatures.length > 0 ? found : null;
            });

            // Text that is not in the buffer: the full signature from the declaration.
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
