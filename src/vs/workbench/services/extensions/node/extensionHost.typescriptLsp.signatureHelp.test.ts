import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { manifestWithDefaults } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideSignatureHelp,
    signatureHelpCharacters,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ICoreSignatureHelp } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

const require_ = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const CLIENT_BUNDLE = path.join(REPO_ROOT, "extensions/diode-lsp-typescript/out/extension.cjs");
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

const DEFS_TS = "export function greet(name: string, age: number): string {\n    return name + String(age);\n}\n";
const MAIN_SAVED = 'import { greet } from "./defs";\n';
const MAIN_TYPING = 'import { greet } from "./defs";\nconst reply = greet(';

function lspClientRegistration(): IExtensionRegistration {
    return {
        id: "diode.diode-lsp-typescript",
        manifest: manifestWithDefaults(
            { name: "diode-lsp-typescript", publisher: "diode", version: "0.1.0" },
            {
                "diode.lsp.typescript.enabled": true,
                "diode.lsp.typescript.serverPath": "",
                "diode.lsp.typescript.tsserverPath": "",
            },
        ),
        mainPath: CLIENT_BUNDLE,
        activationEvents: ["onLanguage:typescript"],
    };
}

async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(500);
    }
}

describe("ExtensionHost — signature help from the stock typescript-language-server", () => {
    beforeAll(async () => {
        const { buildExtensions } = (await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        )) as { buildExtensions: (options: { repoRoot: string }) => Promise<unknown> };
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("the signature of a call from a neighbouring module reaches the core, the active parameter follows the comma", async () => {
        const outputLines: { level: string; value: string }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: TS_LANGUAGE_SERVICE,
            activateEvents: [],
            configuration: {
                diode: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
            },
            outputSink: {
                append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                show: () => undefined,
            },
            extensions: [lspClientRegistration()],
        });
        try {
            harness.writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
            harness.writeFile("defs.ts", DEFS_TS);
            const mainPath = harness.writeFile("main.ts", MAIN_SAVED);
            const mainUri = Uri.file(mainPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            // Trigger characters come from the server itself, not hardcoded in the core.
            const document = { uri: mainUri, languageId: "typescript" };
            await until("trigger characters declared by the server", async () => {
                await settle(0);
                return signatureHelpCharacters(harness, document).triggerCharacters.length > 0 ? true : null;
            });
            expect(signatureHelpCharacters(harness, document)).toEqual({
                triggerCharacters: ["(", ",", "<"],
                retriggerCharacters: [")"],
            });

            // The text with the call is not on disk: the server sees it only through didChange.
            const editor = harness.group.getActiveEditor();
            editor?.applyExternalEdits(
                [createTextEdit(createRange(1, 0, 1, 0), MAIN_TYPING.slice(MAIN_SAVED.length))],
                "type call",
            );
            expect(editor?.getText()).toBe(MAIN_TYPING);
            const help = await until("signature help after `greet(`", async () => {
                const found: ICoreSignatureHelp | null = await provideSignatureHelp(harness, {
                    uri: mainUri,
                    languageId: "typescript",
                    versionId: documentVersion(harness, mainUri),
                    line: 1,
                    character: MAIN_TYPING.length - 32,
                    triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
                    triggerCharacter: "(",
                    isRetrigger: false,
                });
                return found !== null && found.signatures.length > 0 ? found : null;
            });

            expect(help.signatures[0].label).toBe("greet(name: string, age: number): string");
            expect(help.activeParameter).toBe(0);
            expect(help.signatures[0].parameters.map((p) => p.label)).toEqual(["name: string", "age: number"]);

            const afterComma = `${MAIN_TYPING}"world",`;
            editor?.applyExternalEdits(
                [createTextEdit(createRange(1, MAIN_TYPING.length - 32, 1, MAIN_TYPING.length - 32), '"world",')],
                "type argument",
            );
            expect(editor?.getText()).toBe(afterComma);
            const second = await until("active parameter after the comma", async () => {
                const found = await provideSignatureHelp(harness, {
                    uri: mainUri,
                    languageId: "typescript",
                    versionId: documentVersion(harness, mainUri),
                    line: 1,
                    character: afterComma.length - 32,
                    triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
                    triggerCharacter: ",",
                    isRetrigger: true,
                    activeSignatureHelp: help,
                });
                return found !== null && found.activeParameter === 1 ? found : null;
            });
            expect(second.signatures[0].label).toBe("greet(name: string, age: number): string");

            const conversionErrors = outputLines.filter((line) =>
                /is not a constructor|Converting|Cannot read propert/i.test(line.value),
            );
            expect(conversionErrors).toEqual([]);
        } finally {
            await harness.dispose();
        }
    }, 180_000);
});
