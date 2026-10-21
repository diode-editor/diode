import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    type IExtensionHarness,
    manifestWithDefaults,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { selectionToRange } from "../../../../editor/common/core/iSelection.ts";
import { NULL_LANGUAGE_CONFIGURATION_SERVICE } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import type { IExtensionRegistration } from "../../../services/extensions/node/iExtensionEntry.ts";

import { SmartSelectService } from "./smartSelectService.ts";

// Stock stack (`diode-lsp-typescript` + `typescript-language-server`): the client converter builds
// `new code.SelectionRange(range, parent)` — without the class at runtime the response failed with "is not a constructor".

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

const MAIN_TS =
    'function greet(name: string): string {\n    return "hi " + name;\n}\n\nconst hello = greet("world");\n';

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

/** Polling with a deadline: the server takes seconds to start, sleeps won't do. */
async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(500);
    }
}

describe("Expand Selection от стокового typescript-language-server", () => {
    beforeAll(async () => {
        // Fresh client bundle: the test covers exactly what ships in the app.
        const { buildExtensions } = (await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        )) as { buildExtensions: (options: { repoRoot: string }) => Promise<unknown> };
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("ступени синтаксиса сервера: строка-литерал, вызов, объявление", { timeout: 180_000 }, async () => {
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
            const mainPath = harness.writeFile("main.ts", MAIN_TS);
            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");
            const editor = harness.group.getActiveEditor();
            if (editor === null) throw new Error("no active editor");

            // Cursor inside `world` in `greet("world")`, line 4.
            const caret = { line: 4, character: 23 };
            await until("сервер отвечает иерархией выделений", async () => {
                const provider = harness.languageFeatures.selectionRangeProvider.ordered(editor).at(0);
                if (provider === undefined) return null;
                const request = {
                    uri: editor.uri.toString(),
                    languageId: "typescript",
                    versionId: editor.viewState.document.versionId,
                    positions: [caret],
                };
                const answer = await provider.provideSelectionRanges(request, CancellationTokenNone);
                return (answer.at(0)?.length ?? 0) > 0 ? true : null;
            });

            editor.goToPosition(caret.line, caret.character);
            const service = new SmartSelectService(
                harness.group,
                harness.languageFeatures,
                NULL_LANGUAGE_CONFIGURATION_SERVICE,
                new InMemoryConfigurationService(),
            );
            const steps: string[] = [];
            for (let i = 0; i < 6; i++) {
                await service.run(true);
                const { viewState } = editor;
                steps.push(viewState.document.getTextInRange(selectionToRange(viewState.selections[0])));
            }

            // The word is a built-in step, the literal and the call are server steps:
            // built-in brackets stay silent while a provider is live, as upstream.
            expect(steps.slice(0, 3)).toEqual(["world", '"world"', 'greet("world")']);
            expect(steps).toContain('const hello = greet("world");');

            const conversionErrors = outputLines.filter((line) =>
                /is not a constructor|Converting|Cannot read propert/i.test(line.value),
            );
            expect(conversionErrors).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
