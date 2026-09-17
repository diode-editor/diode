import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { organizeImportsAction } from "../../../browser/actions/codeActionActions.ts";
import { redoAction, undoAction } from "../../../browser/actions/editorEditActions.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Code actions поверх СТОКОВОГО стека (правило AGENTS): настоящий builtin
// `diode-lsp-typescript` + настоящий `typescript-language-server`.
//
// 1. Organize Imports — сервер отдаёт action вида `source.organizeImports.ts` с
//    готовым WorkspaceEdit (documentChanges): проверяет и иерархический матч
//    `only`, и tuple-форму `WorkspaceEdit.set` конвертера клиента, и применение
//    через workspace.applyEdit.
// 2. Quick fix «удалить неиспользуемый импорт» + Ctrl+Z/Ctrl+Shift+Z. Сервер
//    присылает правку ДВУМЯ смежными диапазонами на одной строке (", " и
//    "assert"), обратные правки которых схлопываются в одну точку — именно на
//    этой форме undo перемешивал текст. Ядро контракта закрыто герметично в
//    textDocument.inverseEdits.test.ts / undoManager.externalBatch.test.ts.

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

// Импорты в обратном алфавитном порядке — organize imports их пересортирует.
const MAIN_TS = 'import { zeta } from "./zeta";\nimport { alpha } from "./alpha";\n\nalpha();\nzeta();\n';

// Файл для quick fix: `assert` импортирован и не используется (tsserver даёт
// 6133). Диапазон идентификатора в первой строке — (0,15)-(0,21).
const UNUSED_TS = 'import { alpha, zeta } from "./both.js";\n\nalpha();\n';
const BOTH_TS = "export function alpha(): void {}\nexport function zeta(): void {}\n";
const UNUSED_FIXED = 'import { alpha } from "./both.js";\n\nalpha();\n';

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

async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(500);
    }
}

describe("ExtensionHost — code actions от стокового typescript-language-server", () => {
    beforeAll(async () => {
        const { buildExtensions } = await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        );
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("команда пересортировывает импорты правками tsserver'а", { timeout: 180_000 }, async () => {
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
            harness.writeFile("alpha.ts", "export function alpha(): void {}\n");
            harness.writeFile("zeta.ts", "export function zeta(): void {}\n");
            const mainPath = harness.writeFile("main.ts", MAIN_TS);
            const mainUri = Uri.file(mainPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            // Шов: дождаться регистрации провайдера клиентом и непустого ответа
            // сервера на запрошенный вид (иерархический матч .ts-подвида).
            await until("organize imports action от tsserver", async () => {
                const source = harness.group.codeActionSource;
                if (source === undefined) return null;
                const actions = await source.provide({
                    uri: mainUri,
                    languageId: "typescript",
                    text: MAIN_TS,
                    range: createRange(0, 0, 4, 7),
                    only: "source.organizeImports",
                });
                return actions !== null && actions.length > 0 ? actions : null;
            });

            const statusBar = {
                addEntry: () => ({ dispose: () => undefined }),
            } as unknown as StatusBarService;
            const accessor = new Container();
            accessor.bind(EditorServiceDIToken, () => harness.group);
            accessor.bind(StatusBarServiceDIToken, () => statusBar);
            registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, organizeImportsAction);

            await harness.commandRegistry.execute("editor.action.organizeImports");
            await settle();

            const text = harness.group.getActiveEditor()?.getText() ?? "";
            const alphaLine = text.indexOf('import { alpha } from "./alpha";');
            const zetaLine = text.indexOf('import { zeta } from "./zeta";');
            expect(alphaLine).toBeGreaterThanOrEqual(0);
            expect(zetaLine).toBeGreaterThan(alphaLine); // отсортировано
            expect(text).toContain("alpha();");
        } finally {
            await harness.dispose();
        }
    });

    it(
        "quick fix убирает неиспользуемый импорт, Ctrl+Z возвращает строку, Ctrl+Shift+Z повторяет",
        { timeout: 240_000 },
        async () => {
            const published: { resource: string; hasUnused: boolean }[] = [];
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: TS_LANGUAGE_SERVICE,
                activateEvents: [],
                configuration: {
                    diode: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
                },
                diagnosticsSink: (_owner, resource, markers) =>
                    published.push({ resource, hasUnused: markers.some((m) => m.code === "6133") }),
                extensions: [lspClientRegistration()],
            });
            try {
                harness.writeFile(
                    "tsconfig.json",
                    JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true, module: "nodenext" } }),
                );
                harness.writeFile("both.ts", BOTH_TS);
                const mainPath = harness.writeFile("unused.ts", UNUSED_TS);
                const mainUri = Uri.file(mainPath).toString();

                harness.group.openFile(mainPath);
                await harness.host.activateByEvent("onLanguage:typescript");

                // Readiness-сигнал: сервер проиндексировал проект и увидел 6133.
                await until("диагностика 6133 про неиспользуемый zeta", () =>
                    Promise.resolve(published.some((p) => p.resource === mainUri && p.hasUnused) ? true : null),
                );

                const fix = await until("quickfix «Remove unused declaration»", async () => {
                    const source = harness.group.codeActionSource;
                    if (source === undefined) return null;
                    const actions = await source.provide({
                        uri: mainUri,
                        languageId: "typescript",
                        text: harness.group.getActiveEditor()?.getText() ?? "",
                        range: createRange(0, 16, 0, 20), // идентификатор `zeta`
                    });
                    return actions?.find((a) => /unused declaration/i.test(a.title)) ?? null;
                });

                expect(await harness.group.codeActionSource!.apply(fix.id)).toBe(true);
                await settle();
                expect(harness.group.getActiveEditor()?.getText()).toBe(UNUSED_FIXED);

                const accessor = new Container();
                accessor.bind(EditorServiceDIToken, () => harness.group);
                const keybindings = new KeybindingRegistry();
                registerAction(harness.commandRegistry, keybindings, accessor, undoAction);
                registerAction(harness.commandRegistry, keybindings, accessor, redoAction);

                // Ctrl+Z: строка импорта обязана вернуться ДОСЛОВНО — на этой форме
                // правок (два смежных диапазона) она собиралась перемешанной.
                await harness.commandRegistry.execute("undo");
                await settle();
                expect(harness.group.getActiveEditor()?.getText()).toBe(UNUSED_TS);

                await harness.commandRegistry.execute("redo");
                await settle();
                expect(harness.group.getActiveEditor()?.getText()).toBe(UNUSED_FIXED);

                await harness.commandRegistry.execute("undo");
                await settle();
                expect(harness.group.getActiveEditor()?.getText()).toBe(UNUSED_TS);
            } finally {
                await harness.dispose();
            }
        },
    );
});
