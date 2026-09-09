import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ICoreSignatureHelp } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Подсказка параметров поверх СТОКОВОГО стека (правило AGENTS: фича поверх
// стокового расширения закрывается стоковым расширением): настоящий builtin
// `diode-lsp-typescript` + настоящий `typescript-language-server` из devDeps на
// настоящем ext-host subprocess'е. Стоковый клиент сам регистрирует провайдер
// под capability сервера, а его конвертеры дёргают
// `new code.SignatureHelp()`/`SignatureInformation`/`ParameterInformation` и
// читают `code.SignatureHelpTriggerKind.*` — падение любой из этих точек видно
// только здесь, юнит-тест на стабе чужой код не исполняет.

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

const DEFS_TS = "export function greet(name: string, age: number): string {\n    return name + String(age);\n}\n";
/** Сохранённый на диск main.ts вызова ещё не содержит — его допишет тест. */
const MAIN_SAVED = 'import { greet } from "./defs";\n';
/** Правка «без сохранения»: вызов набран, каретка внутри скобок. */
const MAIN_TYPING = 'import { greet } from "./defs";\nconst reply = greet(';

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

describe("ExtensionHost — подсказка параметров от стокового typescript-language-server", () => {
    beforeAll(async () => {
        // Свежий бандл клиента: тест закрывает именно то, что уедет в приложение.
        const { buildExtensions } = await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        );
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("сигнатура вызова из соседнего модуля доезжает до ядра, активный параметр следует за запятой", async () => {
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

            // Триггер-символы приезжают от самого сервера, а не зашиты в ядре.
            await until("объявленные сервером триггер-символы", async () => {
                await settle(0);
                return harness.group.signatureHelpTriggerCharacters.length > 0 ? true : null;
            });
            expect(harness.group.signatureHelpTriggerCharacters).toEqual(["(", ",", "<"]);
            expect(harness.group.signatureHelpRetriggerCharacters).toEqual([")"]);

            // Каретка сразу за `greet(` — текста с вызовом НА ДИСКЕ нет, сервер
            // видит его только через didChange (правило docs/TODO/LSP.md).
            const help = await until("подсказку после `greet(`", async () => {
                const source = harness.group.signatureHelpSource;
                if (source === undefined) return null;
                const found: ICoreSignatureHelp | null = await source({
                    uri: mainUri,
                    languageId: "typescript",
                    text: MAIN_TYPING,
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
            // Метки параметров — подстроки метки сигнатуры (форма tsserver'а).
            expect(help.signatures[0].parameters.map((p) => p.label)).toEqual(["name: string", "age: number"]);

            // После запятой активным становится второй параметр.
            const afterComma = `${MAIN_TYPING}"world",`;
            const second = await until("активный параметр после запятой", async () => {
                const found = await harness.group.signatureHelpSource!({
                    uri: mainUri,
                    languageId: "typescript",
                    text: afterComma,
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

            // Молчаливый провал конвертации чужого кода виден только в канале клиента.
            const conversionErrors = outputLines.filter((line) =>
                /is not a constructor|Converting|Cannot read propert/i.test(line.value),
            );
            expect(conversionErrors).toEqual([]);
        } finally {
            await harness.dispose();
        }
    }, 180_000);
});
