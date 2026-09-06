import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ICoreReference } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Find All References поверх СТОКОВОГО стека (правило AGENTS: фича поверх
// стокового расширения закрывается стоковым расширением): настоящий builtin
// `diode-lsp-typescript` (бандл с vscode-languageclient) + настоящий
// `typescript-language-server` из devDeps на настоящем ext-host subprocess'е.
// Стоковый клиент сам регистрирует reference-провайдер под capability сервера
// (`ReferencesFeature`), а его конвертер строит `new code.Location(...)` —
// падение любой из этих точек видно только здесь, юнит-тест на стабе чужой код
// не исполняет.

const require_ = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const CLIENT_BUNDLE = path.join(REPO_ROOT, "extensions/diode-lsp-typescript/out/extension.cjs");
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

/** Мини-сервис языков: `.ts` → typescript. */
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
        manifest: { name: "diode-lsp-typescript", publisher: "diode", version: "0.1.0" },
        mainPath: CLIENT_BUNDLE,
        activationEvents: ["onLanguage:typescript"],
        configDefaults: {
            "diode.lsp.typescript.enabled": true,
            "diode.lsp.typescript.serverPath": "",
            "diode.lsp.typescript.tsserverPath": "",
        },
    };
}

/** Опрос с дедлайном: сервер индексирует проект секундами, sleep'ы не годятся. */
async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(500);
    }
}

describe("ExtensionHost — references от стокового typescript-language-server", () => {
    beforeAll(async () => {
        // Свежий бандл клиента: тест закрывает именно то, что уедет в приложение.
        const { buildExtensions } = await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        );
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("ссылки на символ доезжают до ядра кросс-файлово", { timeout: 180_000 }, async () => {
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
            const mainUri = Uri.file(mainPath).toString();
            const defsUri = Uri.file(defsPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            // Каретка на вызове `greet` в main.ts — ждём, пока сервер отдаст
            // ссылки не только из открытого файла, но и из defs.ts.
            const references = await until("references для `greet`", async () => {
                const source = harness.group.referenceSource;
                if (source === undefined) return null;
                const found: readonly ICoreReference[] = await source({
                    uri: mainUri,
                    languageId: "typescript",
                    text: MAIN_TS,
                    line: 2,
                    character: 15,
                    includeDeclaration: true,
                });
                const uris = new Set(found.map((ref) => ref.uri));
                return uris.has(defsUri) && uris.has(mainUri) ? found : null;
            });

            // Объявление в defs.ts стоит на строке 0; импорт и вызов — в main.ts
            // на строках 0 и 2. Сервер отдаёт все три (includeDeclaration: true).
            const byUri = new Map<string, number[]>();
            for (const ref of references) {
                byUri.set(ref.uri, [...(byUri.get(ref.uri) ?? []), ref.range.start.line]);
            }
            expect(byUri.get(defsUri)).toEqual([0]);
            expect(byUri.get(mainUri)?.sort((a, b) => a - b)).toEqual([0, 2]);

            // Молчаливый провал конвертации чужого кода виден только в канале клиента.
            const conversionErrors = outputLines.filter((line) =>
                /is not a constructor|Converting|Cannot read propert/i.test(line.value),
            );
            expect(conversionErrors).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
