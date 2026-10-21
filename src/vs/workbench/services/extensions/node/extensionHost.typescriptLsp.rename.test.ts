import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { manifestWithDefaults } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    prepareRenameAt,
    provideReferences,
    provideRename,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";

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

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
const MAIN_TS = 'import { greet } from "./defs";\n\nconst hello = greet("world");\n\nexport { hello };\n';

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

describe("ExtensionHost — rename от стокового typescript-language-server", () => {
    beforeAll(async () => {
        const { buildExtensions } = (await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        )) as { buildExtensions: (options: { repoRoot: string }) => Promise<unknown> };
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("переименование символа правит открытый И закрытый файл", { timeout: 180_000 }, async () => {
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
            const defsPath = harness.writeFile("defs.ts", DEFS_TS);
            const mainPath = harness.writeFile("main.ts", MAIN_TS);
            const defsUri = Uri.file(defsPath).toString();

            // Каретка на объявлении: с вызова импортированного символа tsserver (как и VS Code с
            // `useAliasesForRenames`) переименовал бы только локальный алиас.
            harness.group.openFile(defsPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            const request = {
                uri: defsUri,
                languageId: "typescript",
                versionId: documentVersion(harness, defsUri),
                line: 0,
                character: 18,
            };

            const prepared = await until("prepareRename для `greet`", async () => {
                const location = await prepareRenameAt(harness, request);
                return location.name === null ? null : location;
            });
            expect(prepared).toEqual({ name: "greet" });

            // На холодном старте tsserver отвечает по одному открытому файлу — ждём ссылок из закрытого main.ts.
            await until("сервер видит ссылки из закрытого main.ts", async () => {
                const refs = await provideReferences(harness, { ...request, includeDeclaration: true });
                return refs.some((ref) => ref.uri === Uri.file(mainPath).toString()) ? true : null;
            });

            const result = await provideRename(harness, request, "welcome");
            await settle();
            expect(result).toEqual({ applied: true });

            expect(harness.group.getActiveEditor()?.getText()).toContain("export function welcome(");
            const mainText = fs.readFileSync(mainPath, "utf8");
            expect(mainText).toContain("import { welcome }");
            expect(mainText).toContain('welcome("world")');

            const conversionErrors = outputLines.filter((line) =>
                /is not a constructor|Converting|Cannot read propert/i.test(line.value),
            );
            expect(conversionErrors).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
