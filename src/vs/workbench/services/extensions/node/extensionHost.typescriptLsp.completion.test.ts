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
import type { ICoreCompletionItem } from "../../../../editor/common/languages/iCompletionSource.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Автодополнение поверх СТОКОВОГО стека (правило AGENTS: фича поверх стокового
// расширения закрывается стоковым расширением): настоящий builtin
// `diode-lsp-typescript` (бандл с vscode-languageclient) + настоящий
// `typescript-language-server` из devDeps на настоящем ext-host subprocess'е.
//
// Регресс, ради которого тест написан: стоковый конвертер клиента на КАЖДЫЙ
// ответ сервера делает `new code.CompletionList(items, isIncomplete)`, а наш
// `vscode`-стаб этот класс не экспортировал. Конвертация падала целиком, ошибка
// уходила ТОЛЬКО в `client.outputChannel` (грабля из docs/TODO/LSP.md) — попап
// молча оставался без единого LSP-пункта. Юнит-тест на стабе такое не ловит:
// падает не наш код, а чужой, и молча.

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
// Незавершённое выражение `d.` — ровно то состояние буфера, в котором
// пользователь ждёт подсказку (сервер такой текст переживает).
const MAIN_TS = "const d = new Date();\nd.\n";

function lspClientRegistration(): IExtensionRegistration {
    return {
        id: "vexx.diode-lsp-typescript",
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

describe("ExtensionHost — completion от стокового typescript-language-server", () => {
    beforeAll(async () => {
        // Свежий бандл клиента: тест закрывает именно то, что уедет в приложение.
        const { buildExtensions } = await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        );
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("члены типа после точки доезжают до ядра", { timeout: 180_000 }, async () => {
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
            const mainPath = harness.writeFile("main.ts", MAIN_TS);
            const mainUri = Uri.file(mainPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            const completionAt = async (line: number, character: number): Promise<readonly ICoreCompletionItem[]> => {
                const source = harness.group.completionSource;
                if (source === undefined) return [];
                const result = await source({
                    uri: mainUri,
                    languageId: "typescript",
                    text: harness.group.getActiveEditor()?.getText() ?? "",
                    line,
                    character,
                    triggerKind: CompletionTriggerKind.TriggerCharacter,
                    triggerCharacter: ".",
                });
                return result.items;
            };

            // Каретка сразу после `d.` — ждём членов Date от настоящего tsserver.
            const items = await until("completion после `d.`", async () => {
                const found = await completionAt(1, 2);
                return found.length > 0 ? found : null;
            });

            const labels = items.map((item) => item.label);
            expect(labels).toContain("getTime");
            expect(labels).toContain("toISOString");

            // Тот самый молчаливый провал конвертации: TypeError чужого кода
            // виден ТОЛЬКО в канале клиента.
            const conversionErrors = outputLines.filter((line) =>
                /is not a constructor|Converting|Cannot read propert/i.test(line.value),
            );
            expect(conversionErrors).toEqual([]);

            // Границу замены задаёт сервер, и она НЕ совпадает с интуицией:
            // tsserver отдаёт dot-accessor-пункты — range накрывает саму точку
            // (`[1,1)…[1,2)`), а insertText/filterText начинаются с неё
            // (`.getTime`). Отсюда два требования к ядру: префикс считать от
            // провайдерского range (иначе он будет `d.` и не совпадёт ни с чем),
            // а фильтровать по `filterText`, а не по label.
            const getTime = items.find((item) => item.label === "getTime");
            expect(getTime?.range).toMatchObject({
                start: { line: 1, character: 1 },
                end: { line: 1, character: 2 },
            });
            expect(getTime?.insertText).toBe(".getTime");
            expect(getTime?.filterText).toBe(".getTime");

            // Описание в первом ответе не приходит — только по resolve. Это и
            // есть контракт `resolveSupport` стокового клиента.
            expect(getTime?.detail).toBeUndefined();
            expect(getTime?.id).toBeDefined();
            const resolved = await harness.group.completionResolver!(getTime!.id!);
            expect(resolved?.detail).toContain("getTime");
        } finally {
            await harness.dispose();
        }
    });

    it("авто-импорт приезжает правками-спутниками на resolve", { timeout: 180_000 }, async () => {
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: TS_LANGUAGE_SERVICE,
            activateEvents: [],
            configuration: {
                diode: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
            },
            extensions: [lspClientRegistration()],
        });
        try {
            harness.writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
            harness.writeFile("defs.ts", DEFS_TS);
            // `greet` объявлен в соседнем модуле и здесь НЕ импортирован — сервер
            // обязан предложить его вместе с правкой-импортом.
            const mainPath = harness.writeFile("main.ts", "gree\n");
            const mainUri = Uri.file(mainPath).toString();
            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            const greet = await until("пункт greet из соседнего модуля", async () => {
                const result = await harness.group.completionSource!({
                    uri: mainUri,
                    languageId: "typescript",
                    text: "gree\n",
                    line: 0,
                    character: 4,
                });
                return result.items.find((item) => item.label === "greet" && item.id !== undefined) ?? null;
            });

            const resolved = await until("resolve с правкой импорта", async () => {
                const found = await harness.group.completionResolver!(greet.id!);
                return found?.additionalEdits !== undefined ? found : null;
            });
            const importEdit = resolved.additionalEdits?.[0];
            expect(importEdit?.text).toContain("import");
            expect(importEdit?.text).toContain("greet");
        } finally {
            await harness.dispose();
        }
    });
});
