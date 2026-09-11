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
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatDocumentAction } from "../../../browser/actions/formatActions.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken, type StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Форматирование поверх СТОКОВОГО стека (правило AGENTS: фича поверх стокового
// расширения закрывается стоковым расширением): настоящий builtin
// `diode-lsp-typescript` (бандл с vscode-languageclient) + настоящий
// `typescript-language-server` из devDeps. Стоковый клиент регистрирует
// formatting-провайдеры под capability сервера — это единственный тест, где
// его код реально исполняется на нашем шве.

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

const MESSY_TS = "const  answer   =  1;\n";

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

describe("ExtensionHost — форматирование от стокового typescript-language-server", () => {
    beforeAll(async () => {
        // Свежий бандл клиента: тест закрывает именно то, что уедет в приложение.
        const { buildExtensions } = await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        );
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("Shift+Alt+F-команда прогоняет правки tsserver'а до буфера", { timeout: 180_000 }, async () => {
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
            const mainPath = harness.writeFile("main.ts", MESSY_TS);
            const mainUri = Uri.file(mainPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            // Шов: дождаться, пока стоковый клиент зарегистрирует провайдер и
            // настоящий tsserver ответит правками.
            const edits = await until("formatting edits от tsserver", async () => {
                const source = harness.group.formattingSource;
                if (source === undefined) return null;
                const found: readonly ITextEdit[] | null = await source({
                    uri: mainUri,
                    languageId: "typescript",
                    text: MESSY_TS,
                    tabSize: 4,
                    insertSpaces: true,
                });
                return found !== null && found.length > 0 ? found : null;
            });
            expect(edits.length).toBeGreaterThan(0);

            // Настоящая команда (как builtinActions в проде) — и текст в буфере.
            const statusBar = {
                addEntry: () => ({ dispose: () => undefined }),
            } as unknown as StatusBarService;
            const accessor = new Container();
            accessor.bind(EditorServiceDIToken, () => harness.group);
            accessor.bind(StatusBarServiceDIToken, () => statusBar);
            registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, formatDocumentAction);

            await harness.commandRegistry.execute("editor.action.formatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe("const answer = 1;\n");
        } finally {
            await harness.dispose();
        }
    });
});
