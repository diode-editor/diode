import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// Закрытие стека СТОКОВЫМ language-сервером (правило AGENTS: фича поверх
// стокового расширения закрывается стоковым расширением): настоящий builtin
// `vexx-lsp-typescript` (бандл с vscode-languageclient) + настоящий
// `typescript-language-server` из devDeps на настоящем ext-host subprocess'е.
//
// Ключевое требование — тесты над ИЗМЕНЯЕМЫМ кодом: правки НЕ сохраняются на
// диск, сервер обязан видеть живой буфер (доказывает didOpen/didChange
// pipeline, а не чтение с диска).

const require_ = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const CLIENT_BUNDLE = path.join(REPO_ROOT, "extensions/vexx-lsp-typescript/out/extension.cjs");
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

/** Мини-сервис языков: `.ts` → typescript, иначе — undefined. */
const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
    getLanguageDisplayName: () => undefined,
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// Ошибка типов: greet возвращает string, а reply объявлен number.
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

function lspClientRegistration(): IExtensionRegistration {
    return {
        id: "vexx.vexx-lsp-typescript",
        manifest: { name: "vexx-lsp-typescript", publisher: "vexx", version: "0.1.0" },
        mainPath: CLIENT_BUNDLE,
        activationEvents: ["onLanguage:typescript"],
        configDefaults: {
            "vexx.lsp.typescript.enabled": true,
            "vexx.lsp.typescript.serverPath": "",
            "vexx.lsp.typescript.tsserverPath": "",
        },
    };
}

/** Опрос с дедлайном: LSP-сервер индексирует проект секундами, sleep'ы не годятся. */
async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(500);
    }
}

describe("ExtensionHost — стоковый typescript-language-server (сквозняк)", () => {
    beforeAll(async () => {
        // Свежий бандл клиента: тест закрывает именно то, что уедет в приложение.
        const { buildExtensions } = await import(new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href);
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("диагностики и go-to-definition над изменяемым (несохранённым) кодом", { timeout: 180_000 }, async () => {
        const published: { resource: string; markers: readonly WireMarker[] }[] = [];
        const progressEvents: { kind: string; handle: number; title?: string }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: TS_LANGUAGE_SERVICE,
            activateEvents: [],
            configuration: {
                vexx: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
            },
            diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
            progressSink: {
                start: (handle, title) => progressEvents.push({ kind: "start", handle, title }),
                report: (handle) => progressEvents.push({ kind: "report", handle }),
                end: (handle) => progressEvents.push({ kind: "end", handle }),
            },
            extensions: [lspClientRegistration()],
        });
        try {
            harness.writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
            const defsPath = harness.writeFile("defs.ts", DEFS_TS);
            const mainPath = harness.writeFile("main.ts", MAIN_TS);
            const mainUri = Uri.file(mainPath).toString();
            const defsUri = Uri.file(defsPath).toString();
            const markersFor = (uri: string): readonly WireMarker[] =>
                published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            // Прогресс запуска (наш withProgress вокруг client.start()) виден
            // сразу после активации — и обязан закрыться по готовности сервера.
            const startEvent = progressEvents.find((e) => e.kind === "start");
            expect(startEvent?.title).toContain("TypeScript (Vexx)");
            expect(startEvent?.title).toContain("starting language server");
            await until("прогресс запуска закрылся (end)", () => {
                const done = progressEvents.some((e) => e.kind === "end" && e.handle === startEvent?.handle);
                return Promise.resolve(done ? true : null);
            });

            // Диагностика от НАСТОЯЩЕГО tsserver'а — она же readiness-сигнал
            // «сервер проиндексировал проект» перед go-to-definition.
            const marker = await until("диагностика 'not assignable' в main.ts", () => {
                const hit = markersFor(mainUri).find((m) => /not assignable to type 'number'/.test(m.message));
                return Promise.resolve(hit ?? null);
            });
            expect(marker.startLine).toBe(2);
            expect(marker.source).toBe("typescript");

            // Go to Definition: каретка на вызове greet → объявление в defs.ts.
            const source = harness.group.definitionSource;
            const definitionAt = (line: number, character: number) =>
                source!({
                    uri: mainUri,
                    languageId: "typescript",
                    text: harness.group.getActiveEditor()?.getText() ?? "",
                    line,
                    character,
                });
            const locations = await until("definition вызова greet", async () => {
                const found = await definitionAt(2, 23);
                return found.length > 0 ? found : null;
            });
            expect(locations[0].uri).toBe(defsUri);
            expect(locations[0].range.start).toMatchObject({ line: 0, character: 16 });

            // ИЗМЕНЯЕМЫЙ КОД: сдвигаем объявление greet в defs.ts на 2 строки
            // вниз, НЕ сохраняя на диск. Сервер обязан увидеть живой буфер.
            harness.group.openFile(defsPath);
            harness.group.getActiveEditor()?.applyExternalEdits(
                [createTextEdit(createRange(0, 0, 0, 0), "// prologue\n\n")],
                "unsaved edit",
            );
            await settle();
            harness.group.openFile(mainPath);

            const moved = await until("definition после несохранённой правки defs.ts", async () => {
                const found = await definitionAt(2, 23);
                return found.length > 0 && found[0].range.start.line === 2 ? found : null;
            });
            expect(moved[0].uri).toBe(defsUri);
            expect(moved[0].range.start).toMatchObject({ line: 2, character: 16 });

            // Чиним ошибку типов правкой (тоже без сохранения) — маркер обязан уйти.
            harness.group.getActiveEditor()?.applyExternalEdits(
                [createTextEdit(createRange(2, 13, 2, 19), "string")],
                "fix type",
            );
            await until("диагностика main.ts ушла после фикса", () =>
                Promise.resolve(markersFor(mainUri).length === 0 ? true : null),
            );
        } finally {
            await harness.dispose();
        }
    });
});
