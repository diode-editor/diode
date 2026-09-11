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
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { organizeImportsAction } from "../../../browser/actions/codeActionActions.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken, type StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Organize Imports поверх СТОКОВОГО стека (правило AGENTS): настоящий builtin
// `diode-lsp-typescript` + настоящий `typescript-language-server`. Сервер
// отдаёт action вида `source.organizeImports.ts` с готовым WorkspaceEdit
// (documentChanges) — проверяет и иерархический матч `only`, и tuple-форму
// `WorkspaceEdit.set` конвертера клиента, и применение через workspace.applyEdit.

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

describe("ExtensionHost — organize imports от стокового typescript-language-server", () => {
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
});
