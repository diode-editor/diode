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

// Rename Symbol поверх СТОКОВОГО стека (правило AGENTS: фича поверх стокового
// расширения закрывается стоковым расширением): настоящий builtin
// `diode-lsp-typescript` (бандл с vscode-languageclient) + настоящий
// `typescript-language-server` из devDeps на настоящем ext-host subprocess'е.
// Стоковый клиент сам регистрирует rename-провайдер под capability сервера
// (`RenameFeature` с `prepareProvider`), а его конвертер строит
// `new code.WorkspaceEdit()` и зовёт `edit.set(...)` — падение любой из этих
// точек видно только здесь, юнит-тест на стабе чужой код не исполняет.

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

describe("ExtensionHost — rename от стокового typescript-language-server", () => {
    beforeAll(async () => {
        // Свежий бандл клиента: тест закрывает именно то, что уедет в приложение.
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

            // Открыт ОБЪЯВЛЯЮЩИЙ файл, потребитель (main.ts) закрыт: так
            // видно и правку буфера, и запись на диск. Каретка на имени в
            // объявлении — переименование едет по всем файлам; с каретки на
            // ВЫЗОВЕ импортированного символа tsserver (как и VS Code с его
            // `useAliasesForRenames`) переименовал бы только локальный алиас.
            harness.group.openFile(defsPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            // `greet` в `export function greet(` — строка 0, колонки 16..21.
            const request = {
                uri: defsUri,
                languageId: "typescript",
                versionId: documentVersion(harness, defsUri),
                line: 0,
                character: 18,
            };

            // `prepareRename` сервера называет текущее имя символа — им
            // предзаполняется поле ввода.
            const prepared = await until("prepareRename для `greet`", async () => {
                const location = await prepareRenameAt(harness, request);
                return location.name === null ? null : location;
            });
            expect(prepared).toEqual({ name: "greet" });

            // Ждём, пока сервер увидит ВЕСЬ проект: на холодном старте tsserver
            // отвечает по одному открытому файлу, и переименование уехало бы
            // мимо закрытого потребителя. Признак готовности — ссылки из main.ts.
            await until("сервер видит ссылки из закрытого main.ts", async () => {
                const refs = await provideReferences(harness, { ...request, includeDeclaration: true });
                return refs.some((ref) => ref.uri === Uri.file(mainPath).toString()) ? true : null;
            });

            const result = await provideRename(harness, request, "welcome");
            await settle();
            expect(result).toEqual({ applied: true });

            // Открытая вкладка: объявление переименовано через свой буфер.
            expect(harness.group.getActiveEditor()?.getText()).toContain("export function welcome(");
            // ЗАКРЫТЫЙ main.ts переименован на диске — и импорт, и вызов (bulk edit).
            const mainText = fs.readFileSync(mainPath, "utf8");
            expect(mainText).toContain("import { welcome }");
            expect(mainText).toContain('welcome("world")');

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
