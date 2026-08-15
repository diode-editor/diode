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
// `diode-lsp-typescript` (бандл с vscode-languageclient) + настоящий
// `typescript-language-server` из devDeps на настоящем ext-host subprocess'е.
//
// Ключевое требование — тесты над ИЗМЕНЯЕМЫМ кодом: правки НЕ сохраняются на
// диск, сервер обязан видеть живой буфер (доказывает didOpen/didChange
// pipeline, а не чтение с диска).

const require_ = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const CLIENT_BUNDLE = path.join(REPO_ROOT, "extensions/diode-lsp-typescript/out/extension.cjs");
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

/** Мини-сервис языков: `.ts` → typescript, `.md` → markdown, иначе — undefined. */
const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) =>
        filePath.endsWith(".ts") ? "typescript" : filePath.endsWith(".md") ? "markdown" : undefined,
    getLanguageDisplayName: () => undefined,
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// Ошибка типов: greet возвращает string, а reply объявлен number.
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

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

    it("смешанный воркспейс не отравляет сервер: markdown не синхронизируется, канал без ошибок", { timeout: 180_000 }, async () => {
        // Регресс пользовательского сценария (реальный проект): subprocess уже
        // жив (eager-расширение, как builtin git), АКТИВНЫЙ файл при спавне —
        // markdown, ts-файл открывается ПОЗЖЕ и активирует клиент. До фикса
        // сервер получал didOpen для markdown (наивный languages.match) и
        // meta-обёртки с пустым текстом (didOpen гейтился подпиской) — и ронял
        // хендлеры: «Cannot open document (languageId: markdown)», «Unexpected
        // resource», падения foldingRange. Ошибки сервера клиент пишет в свой
        // output-канал — по нему и ассертим.
        const published: { resource: string; markers: readonly WireMarker[] }[] = [];
        const outputLines: { level: string; value: string }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: TS_LANGUAGE_SERVICE,
            activateEvents: ["*"], // noop активируется сразу — subprocess жив до открытия файлов
            configuration: {
                diode: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
            },
            diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
            outputSink: {
                append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                show: () => undefined,
            },
            extensions: [
                extensionFixture("test.noop", "noopExtension.cjs"),
                { ...lspClientRegistration(), activationEvents: ["onLanguage:typescript"] },
            ],
        });
        try {
            harness.writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
            const readmePath = harness.writeFile("README.md", "# Проект\n\nОписание.\n");
            const mainPath = harness.writeFile("main.ts", MAIN_TS);
            harness.writeFile("defs.ts", DEFS_TS);
            const mainUri = Uri.file(mainPath).toString();

            // markdown активен при живом subprocess ДО активации клиента —
            // он попадает в workspace.textDocuments (полным, didOpen не гейтится).
            harness.group.openFile(readmePath);
            await settle();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            // Положительный сигнал: сервер жив, проект обработан, диагностика пришла.
            await until("диагностика на main.ts", () => {
                const hit = published.some(
                    (p) => p.resource === mainUri && p.markers.some((m) => /not assignable/.test(m.message)),
                );
                return Promise.resolve(hit ? true : null);
            });

            // Погонять вкладки markdown ↔ ts при подписанном клиенте — didOpen
            // markdown обязан отфильтроваться настоящим languages.match.
            harness.group.openFile(readmePath);
            await settle();
            harness.group.openFile(mainPath);
            await settle(1000);

            // Канал клиента чист: серверные window/logMessage об ошибках didOpen /
            // «Unexpected resource» / упавших хендлерах отсутствуют.
            const errors = outputLines.filter((l) =>
                /Cannot open document|Unexpected resource|already open|failed with message/i.test(l.value),
            );
            expect(errors).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });

    it("диагностики и go-to-definition над изменяемым (несохранённым) кодом", { timeout: 180_000 }, async () => {
        const published: { resource: string; markers: readonly WireMarker[] }[] = [];
        const progressEvents: { kind: string; handle: number; title?: string }[] = [];
        const outputLines: { channel: string; label: string; level: string; value: string }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: TS_LANGUAGE_SERVICE,
            activateEvents: [],
            configuration: {
                diode: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
            },
            diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
            progressSink: {
                start: (handle, title) => progressEvents.push({ kind: "start", handle, title }),
                report: (handle) => progressEvents.push({ kind: "report", handle }),
                end: (handle) => progressEvents.push({ kind: "end", handle }),
            },
            outputSink: {
                append: (channel, label, level, value) => outputLines.push({ channel, label, level, value }),
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
            const markersFor = (uri: string): readonly WireMarker[] =>
                published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            // Прогресс запуска (наш withProgress вокруг client.start()) виден
            // сразу после активации — и обязан закрыться по готовности сервера.
            const startEvent = progressEvents.find((e) => e.kind === "start");
            expect(startEvent?.title).toContain("TypeScript (Diode)");
            expect(startEvent?.title).toContain("starting language server");
            await until("прогресс запуска закрылся (end)", () => {
                const done = progressEvents.some((e) => e.kind === "end" && e.handle === startEvent?.handle);
                return Promise.resolve(done ? true : null);
            });

            // Output-канал клиента — настоящий: строка о старте сервера доехала
            // с label канала (селектор Output) и id вида extensions.<slug>.
            const started = await until("строка о старте сервера в output-канале", () => {
                const line = outputLines.find((l) => l.value.includes("language server started"));
                return Promise.resolve(line ?? null);
            });
            expect(started.channel).toBe("extensions.typescript-diode");
            expect(started.label).toBe("TypeScript (Diode)");
            expect(started.level).toBe("info");

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

            // Регрессия «Unexpected resource»: фолдинг для файла, который ядро
            // НИКОГДА не анонсировало didOpen'ом (не открывался в редакторе).
            // languages.provide* обязан сам провести didOpen через documentSync
            // ДО вызова провайдера — иначе клиент шлёт серверу foldingRange по
            // неизвестному документу и получает отказ (фолдов нет).
            const extraPath = harness.writeFile("extra.ts", "export function block(): void {\n    void 0;\n    void 0;\n}\n");
            const foldSource = harness.group.foldingRangeSource;
            const folds = await until("фолды неанонсированного extra.ts", async () => {
                const found = await foldSource!({
                    uri: Uri.file(extraPath).toString(),
                    languageId: "typescript",
                    text: "export function block(): void {\n    void 0;\n    void 0;\n}\n",
                });
                return found.length > 0 ? found : null;
            });
            expect(folds[0]).toMatchObject({ startLine: 0 });

            // Регрессия крэша tsserver «reading 'charCount'»: запрос с НОВЫМ
            // текстом уходит в ТОМ ЖЕ тике, что и правка, — обгоняя
            // коалесированный (microtask) didChange. Раньше он писал текст в
            // реестр мимо событий, следующий didChange нёс диапазон от уже
            // нового текста, и tsserver получал правку за пределами своей копии.
            harness.group.openFile(mainPath);
            const editor = harness.group.getActiveEditor();
            editor?.applyExternalEdits([createTextEdit(createRange(4, 0, 4, 0), "\nconst tail = 1;\n")], "grow");
            const racing = foldSource!({
                uri: mainUri,
                languageId: "typescript",
                text: editor?.getText() ?? "",
            });
            await racing;
            // Сервер жив и видит согласованный буфер: ломаем типы ещё раз и
            // ждём диагностику на ПРАВИЛЬНОЙ строке.
            editor?.applyExternalEdits([createTextEdit(createRange(2, 13, 2, 19), "number")], "break again");
            const reMarker = await until("диагностика после гонки didChange/фолдинга", () => {
                const hit = markersFor(mainUri).find((m) => /not assignable to type 'number'/.test(m.message));
                return Promise.resolve(hit ?? null);
            });
            expect(reMarker.startLine).toBe(2);
            // Канал чист от крэшей tsserver и отказов по неизвестным документам.
            const serverErrors = outputLines.filter((l) =>
                /charCount|TypeScript Server Error|Unexpected resource|should be opened/i.test(l.value),
            );
            expect(serverErrors).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
