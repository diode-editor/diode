import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    manifestWithDefaults,
    provideCodeActions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { redoAction, undoAction } from "../../../browser/actions/editorEditActions.ts";
import { organizeImportsAction } from "../../../contrib/codeAction/browser/codeActionActions.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { EditorServiceDIToken } from "../../editor/common/editorService.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Quick fix "remove unused import": the server sends the edit as TWO adjacent ranges on one line,
// their inverse edits collapse into a point, and on this shape undo scrambled the text.
// Organize Imports in CommonJS: the server returns no action, the client substitutes a no-op one (as the
// upstream TS extension does), and the command stays silent instead of printing "No organize imports action".

const require_ = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const CLIENT_BUNDLE = path.join(REPO_ROOT, "extensions/diode-lsp-typescript/out/extension.cjs");
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) =>
        filePath.endsWith(".ts") ? "typescript" : filePath.endsWith(".js") ? "javascript" : undefined,
    getLanguageDisplayName: () => undefined,
};

const MAIN_TS = 'import { zeta } from "./zeta";\nimport { alpha } from "./alpha";\n\nalpha();\nzeta();\n';

const UNUSED_TS = 'import { alpha, zeta } from "./both.js";\n\nalpha();\n';
const BOTH_TS = "export function alpha(): void {}\nexport function zeta(): void {}\n";
const UNUSED_FIXED = 'import { alpha } from "./both.js";\n\nalpha();\n';

const REQUIRE_JS = 'const z = require("./zeta.js");\nconst a = require("./alpha.js");\n\na.alpha();\nz.zeta();\n';

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

async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(500);
    }
}

describe("ExtensionHost — code actions from the stock typescript-language-server", () => {
    beforeAll(async () => {
        const { buildExtensions } = (await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        )) as { buildExtensions: (options: { repoRoot: string }) => Promise<unknown> };
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it("the command re-sorts imports with tsserver's edits", { timeout: 180_000 }, async () => {
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

            await until("organize imports action from tsserver", async () => {
                const actions = await provideCodeActions(harness, {
                    uri: mainUri,
                    languageId: "typescript",
                    versionId: documentVersion(harness, mainUri),
                    range: createRange(0, 0, 4, 7),
                    only: "source.organizeImports",
                });
                return actions.length > 0 ? actions : null;
            });

            const statusBar = {
                addEntry: () => ({ dispose: () => undefined }),
            } as unknown as StatusBarService;
            const accessor = new Container();
            accessor.bind(EditorServiceDIToken, () => harness.group);
            accessor.bind(LanguageFeaturesServiceDIToken, () => harness.languageFeatures);
            accessor.bind(StatusBarServiceDIToken, () => statusBar);
            registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, organizeImportsAction);

            await harness.commandRegistry.execute("editor.action.organizeImports");
            await settle();

            const text = harness.group.getActiveEditor()?.getText() ?? "";
            const alphaLine = text.indexOf('import { alpha } from "./alpha";');
            const zetaLine = text.indexOf('import { zeta } from "./zeta";');
            expect(alphaLine).toBeGreaterThanOrEqual(0);
            expect(zetaLine).toBeGreaterThan(alphaLine); // sorted
            expect(text).toContain("alpha();");
        } finally {
            await harness.dispose();
        }
    });

    it("on a CommonJS .js file the command is a no-op, without a message", { timeout: 180_000 }, async () => {
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: TS_LANGUAGE_SERVICE,
            activateEvents: [],
            configuration: {
                diode: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
            },
            extensions: [lspClientRegistration()],
        });
        try {
            harness.writeFile("alpha.js", "exports.alpha = () => {};\n");
            harness.writeFile("zeta.js", "exports.zeta = () => {};\n");
            const mainPath = harness.writeFile("main.js", REQUIRE_JS);
            const mainUri = Uri.file(mainPath).toString();

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            const actions = await until("organize imports action for .js", async () => {
                const found = await provideCodeActions(harness, {
                    uri: mainUri,
                    languageId: "javascript",
                    versionId: documentVersion(harness, mainUri),
                    range: createRange(0, 0, 5, 0),
                    only: "source.organizeImports",
                });
                return found.length > 0 ? found : null;
            });
            expect(actions.map((a) => [a.title, a.kind])).toEqual([["Organize Imports", "source.organizeImports.ts"]]);

            const notices: string[] = [];
            const statusBar = {
                addEntry: (entry: { text: string }) => {
                    notices.push(entry.text);
                    return { dispose: () => undefined };
                },
            } as unknown as StatusBarService;
            const accessor = new Container();
            accessor.bind(EditorServiceDIToken, () => harness.group);
            accessor.bind(LanguageFeaturesServiceDIToken, () => harness.languageFeatures);
            accessor.bind(StatusBarServiceDIToken, () => statusBar);
            registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, organizeImportsAction);
            const versionBefore = documentVersion(harness, mainUri);

            await harness.commandRegistry.execute("editor.action.organizeImports");
            await settle();

            expect(notices).toEqual([]);
            expect(harness.group.getActiveEditor()?.getText()).toBe(REQUIRE_JS);
            expect(documentVersion(harness, mainUri)).toBe(versionBefore);
        } finally {
            await harness.dispose();
        }
    });

    it(
        "quick fix removes an unused import, Ctrl+Z brings the line back, Ctrl+Shift+Z redoes",
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

                await until("diagnostic 6133 about the unused zeta", () =>
                    Promise.resolve(published.some((p) => p.resource === mainUri && p.hasUnused) ? true : null),
                );

                const fix = await until("quickfix «Remove unused declaration»", async () => {
                    const actions = await provideCodeActions(harness, {
                        uri: mainUri,
                        languageId: "typescript",
                        versionId: documentVersion(harness, mainUri),
                        range: createRange(0, 16, 0, 20), // the `zeta` identifier
                    });
                    return actions.find((a) => /unused declaration/i.test(a.title)) ?? null;
                });

                expect(await harness.host.applyCodeAction(fix.id)).toBe(true);
                await settle();
                expect(harness.group.getActiveEditor()?.getText()).toBe(UNUSED_FIXED);

                const accessor = new Container();
                accessor.bind(EditorServiceDIToken, () => harness.group);
                accessor.bind(LanguageFeaturesServiceDIToken, () => harness.languageFeatures);
                const keybindings = new KeybindingRegistry();
                registerAction(harness.commandRegistry, keybindings, accessor, undoAction);
                registerAction(harness.commandRegistry, keybindings, accessor, redoAction);

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
