import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

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
import { ExtensionLanguageStatusAdapter } from "../../../api/browser/extensionLanguageStatusAdapter.ts";
import { LanguageStatusService } from "../../languageStatus/common/languageStatusService.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// The JS/TS project status over the stock typescript-language-server: "No jsconfig" for a file in an inferred
// project, "Configure JSConfig" writes the config, the status then names it, and tsserver picks the new config up
// without a restart: "Move to a new file" now rewrites the import in a file nobody opened.

const require_ = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const CLIENT_BUNDLE = path.join(REPO_ROOT, "extensions/diode-lsp-typescript/out/extension.cjs");
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const JS_TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) =>
        filePath.endsWith(".ts") ? "typescript" : filePath.endsWith(".js") ? "javascript" : undefined,
    getLanguageDisplayName: () => undefined,
};

const SHAPES_JS =
    "export class Circle {\n  area() { return 1; }\n}\n\nexport class Square {\n  area() { return 2; }\n}\n";
const MAIN_JS =
    'import { Circle, Square } from "./shapes.js";\n\nconsole.log(new Circle().area(), new Square().area());\n';

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
        activationEvents: ["onLanguage:javascript", "onLanguage:typescript"],
    };
}

async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(250);
    }
}

const cleanups: (() => void)[] = [];

/**
 * tsserver does not watch config files two levels below `/` (`canWatchDirectoryOrFilePath` takes them for a home
 * directory), and `os.tmpdir()/diode-ext-*` is exactly that: the project goes deeper.
 */
function makeProject(files: Record<string, string>): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "diode-project-status-"));
    cleanups.push(() => {
        fs.rmSync(base, { recursive: true, force: true });
    });
    const root = path.join(base, "home", "proj");
    for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
}

describe("ExtensionHost — JS/TS project status from the stock typescript-language-server", () => {
    beforeAll(async () => {
        const { buildExtensions } = (await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        )) as { buildExtensions: (options: { repoRoot: string }) => Promise<unknown> };
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    async function start(root: string | undefined, service: LanguageStatusService): Promise<IExtensionHarness> {
        return createExtensionTestHarness({
            languageService: JS_TS_LANGUAGE_SERVICE,
            activateEvents: [],
            languageStatusSink: new ExtensionLanguageStatusAdapter(service),
            configuration: {
                diode: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
            },
            ...(root === undefined ? {} : { workspaceFolders: [root] }),
            extensions: [lspClientRegistration()],
        });
    }

    function statusOf(service: LanguageStatusService, filePath: string, languageId: string) {
        return service
            .getLanguageStatus(Uri.file(filePath), languageId)
            .find((s) => s.id.endsWith("/typescript.projectStatus"));
    }

    it(
        "No jsconfig → Configure JSConfig → the status names jsconfig.json and the move updates an unopened importer",
        { timeout: 240_000 },
        async () => {
            const root = makeProject({
                "package.json": '{"type":"module"}\n',
                "src/shapes.js": SHAPES_JS,
                "src/main.js": MAIN_JS,
            });
            const shapesPath = path.join(root, "src/shapes.js");
            const mainPath = path.join(root, "src/main.js");
            const configPath = path.join(root, "jsconfig.json");
            const service = new LanguageStatusService();
            const harness = await start(root, service);
            try {
                harness.group.openFile(shapesPath);
                await harness.host.activateByEvent("onLanguage:javascript");

                const noConfig = await until("No jsconfig for shapes.js", () => {
                    const status = statusOf(service, shapesPath, "javascript");
                    return Promise.resolve(status?.label === "No jsconfig" ? status : null);
                });
                expect(noConfig).toMatchObject({
                    name: "JS/TS IntelliSense Status",
                    busy: false,
                    command: { id: "_typescript.createOrOpenConfig", title: "Configure JSConfig" },
                });
                // Only JS/TS editors get the item.
                expect(statusOf(service, path.join(root, "package.json"), "json")).toBeUndefined();

                const command = noConfig.command;
                await harness.commandRegistry.execute(command?.id ?? "", ...(command?.arguments ?? []));
                await until("jsconfig.json opened", () =>
                    Promise.resolve(harness.group.getActiveEditor()?.uri.fsPath === configPath ? true : null),
                );
                expect(fs.readFileSync(configPath, "utf8")).toContain('"allowImportingTsExtensions": true');

                // Back in the .js file at once: tsserver polls the missing config (2 s), so the first answer is
                // still the inferred project; the end of the server's background project load re-asks by itself.
                harness.group.openFile(shapesPath);
                const withConfig = await until("jsconfig.json for shapes.js", () => {
                    const status = statusOf(service, shapesPath, "javascript");
                    return Promise.resolve(status?.label === "jsconfig.json" ? status : null);
                });
                expect(withConfig.command).toMatchObject({ id: "_typescript.openConfig", title: "Open Config File" });

                const shapesUri = Uri.file(shapesPath).toString();
                const move = await until("Move to a new file on Square", async () => {
                    const actions = await provideCodeActions(harness, {
                        uri: shapesUri,
                        languageId: "javascript",
                        versionId: documentVersion(harness, shapesUri),
                        range: createRange(4, 13, 4, 13),
                    });
                    return actions.find((a) => a.title === "Move to a new file") ?? null;
                });
                expect(await harness.host.applyCodeAction(move.id)).toBe(true);
                await until("main.js imports Square from its new file", () =>
                    Promise.resolve(fs.readFileSync(mainPath, "utf8").includes('from "./Square.js"') ? true : null),
                );
                expect(fs.readFileSync(mainPath, "utf8")).toBe(
                    'import { Circle } from "./shapes.js";\nimport { Square } from "./Square.js";\n\nconsole.log(new Circle().area(), new Square().area());\n',
                );
            } finally {
                await harness.dispose();
            }
        },
    );

    it(
        "a .ts file and, with allowJs, a .js file under a tsconfig show the tsconfig path",
        { timeout: 240_000 },
        async () => {
            const root = makeProject({
                "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, allowJs: true } }),
                "src/app.ts": "export const x: number = 1;\n",
                "src/util.js": "export const y = 2;\n",
            });
            const appPath = path.join(root, "src/app.ts");
            const utilPath = path.join(root, "src/util.js");
            const service = new LanguageStatusService();
            const harness = await start(root, service);
            try {
                harness.group.openFile(appPath);
                await harness.host.activateByEvent("onLanguage:typescript");

                const status = await until("tsconfig.json for app.ts", () => {
                    const found = statusOf(service, appPath, "typescript");
                    return Promise.resolve(found !== undefined && !found.busy ? found : null);
                });
                expect(status).toMatchObject({ label: "tsconfig.json", command: { title: "Open Config File" } });

                harness.group.openFile(utilPath);
                const jsStatus = await until("tsconfig.json for util.js", () => {
                    const found = statusOf(service, utilPath, "javascript");
                    return Promise.resolve(found !== undefined && !found.busy ? found : null);
                });
                expect(jsStatus).toMatchObject({ label: "tsconfig.json", command: { title: "Open Config File" } });
            } finally {
                await harness.dispose();
            }
        },
    );
});
