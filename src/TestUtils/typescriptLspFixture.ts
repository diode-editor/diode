import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import {
    ConfigurationRegistry,
    type IConfigurationPropertySchema,
} from "../vs/platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../vs/platform/configuration/common/inMemoryConfigurationService.ts";
import type { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { createExtensionTestHarness, type IExtensionHarness } from "./ExtensionTestHarness.ts";

const require_ = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXTENSION_DIR = path.join(REPO_ROOT, "extensions/diode-lsp-typescript");
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".js") ? "javascript" : "typescript"),
    getLanguageDisplayName: () => undefined,
};

type ContributedManifest = IExtensionRegistration["manifest"] & {
    readonly contributes: {
        readonly configuration: { readonly properties: Record<string, IConfigurationPropertySchema> };
    };
};

/** The real manifest: a setting it does not declare has no default, and the tests start from the defaults. */
function readManifest(): ContributedManifest {
    return JSON.parse(readFileSync(path.join(EXTENSION_DIR, "package.json"), "utf8")) as ContributedManifest;
}

export async function buildTypescriptLspExtension(): Promise<void> {
    const { buildExtensions } = (await import(new URL("../../scripts/build-extensions.mjs", import.meta.url).href)) as {
        buildExtensions: (options: { repoRoot: string }) => Promise<unknown>;
    };
    await buildExtensions({ repoRoot: REPO_ROOT });
}

export interface ITypescriptLspFixture {
    readonly harness: IExtensionHarness;
    readonly editor: TextEditorPane;
    /** Live: a write reaches the extension as `onDidChangeConfiguration`. */
    readonly settings: InMemoryConfigurationService;
    frame(): string;
}

/** The built-in extension with the live server over `fileName`, opened in the editor. */
export async function openInTypescriptLsp(
    fileName: string,
    source: string,
    settings: Readonly<Record<string, unknown>> = {},
): Promise<ITypescriptLspFixture> {
    const manifest = readManifest();
    const registry = new ConfigurationRegistry();
    registry.registerConfiguration({
        id: "diode-lsp-typescript",
        properties: manifest.contributes.configuration.properties,
    });
    const service = new InMemoryConfigurationService(
        registry,
        {
            "diode.lsp.typescript.serverPath": SERVER_CLI,
            "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
            ...settings,
        },
        {},
    );
    const harness = await createExtensionTestHarness({
        languageService: LANGUAGE_SERVICE,
        activateEvents: [],
        extensionConfigurationService: service,
        extensions: [
            {
                id: "diode.diode-lsp-typescript",
                manifest,
                mainPath: path.join(EXTENSION_DIR, "out/extension.cjs"),
                activationEvents: ["onLanguage:typescript", "onLanguage:javascript"],
            },
        ],
    });
    harness.writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, allowJs: true } }));
    harness.group.openFile(harness.writeFile(fileName, source));
    const editor = harness.group.getActiveEditor();
    if (editor === null) throw new Error("no active editor");
    await harness.host.activateByEvent(fileName.endsWith(".js") ? "onLanguage:javascript" : "onLanguage:typescript");
    const frame = (): string => {
        harness.app.render();
        return harness.app.backend.screenToString();
    };
    return { harness, editor, settings: service, frame };
}
