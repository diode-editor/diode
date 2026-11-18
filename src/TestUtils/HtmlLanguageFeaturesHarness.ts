import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { Uri } from "../vs/base/common/uri.ts";
import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";
import type { IDeclarativeExtension } from "../vs/workbench/services/extensions/node/extensionRegistration.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    type IExtensionHarnessOptions,
} from "./ExtensionTestHarness.ts";
import { settle } from "./timing.ts";

/**
 * The built-in HTML language features (`extensions/html-language-features`: upstream's client and server, vendored)
 * in the extension harness, against the real server `build-extensions.mjs` builds.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXTENSION_DIR = path.join(REPO_ROOT, "extensions/html-language-features");
const SERVER = path.join(EXTENSION_DIR, "server/out/node/htmlServerMain.mjs");

/** By the file name, as the language registry does: `.hbs` is handlebars, the rest html. */
const HTML_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".hbs") ? "handlebars" : "html"),
    getLanguageDisplayName: () => undefined,
};

/** Builds the client and the server once per file: `beforeAll(buildHtmlLanguageFeatures, 120_000)`. */
export async function buildHtmlLanguageFeatures(): Promise<void> {
    const { buildExtensions } = (await import(new URL("../../scripts/build-extensions.mjs", import.meta.url).href)) as {
        buildExtensions: (options: { repoRoot: string }) => Promise<unknown>;
    };
    await buildExtensions({ repoRoot: REPO_ROOT });
}

/** The builtin as the app registers it: the real manifest, activated by `onLanguage:html`/`onLanguage:handlebars`. */
export function htmlLanguageFeaturesRegistration(): IExtensionRegistration {
    const manifest = JSON.parse(readFileSync(path.join(EXTENSION_DIR, "package.json"), "utf8")) as Record<
        string,
        unknown
    >;
    return {
        id: "vscode.html-language-features",
        manifest: manifest as IExtensionRegistration["manifest"],
        mainPath: path.join(EXTENSION_DIR, "out/extension.cjs"),
        activationEvents: ["onLanguage:html", "onLanguage:handlebars"],
    };
}

export interface IHtmlDocument {
    readonly harness: IExtensionHarness;
    readonly editor: TextEditorPane;
    readonly uri: string;
    readonly languageId: string;
    /** A request at the current version of the document. */
    at(line: number, character: number): {
        uri: string;
        languageId: string;
        versionId: number;
        line: number;
        character: number;
    };
    document(): { uri: string; languageId: string; versionId: number };
}

/**
 * The builtin `handlebars` language pack, declarative as in the app: its `htmlLanguageParticipants` is how the HTML
 * client learns to serve handlebars documents.
 */
function handlebarsDeclarative(): IDeclarativeExtension {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, "extensions/handlebars/package.json"), "utf8")) as Record<
        string,
        unknown
    >;
    return {
        id: "vscode.handlebars",
        manifest: manifest as IDeclarativeExtension["manifest"],
        extensionPath: "/extensions/handlebars",
    };
}

/** Opens `fileName` with `content` in a fresh harness and activates the extension for it. */
export async function openHtmlDocument(
    fileName: string,
    content: string,
    options: Pick<IExtensionHarnessOptions, "configuration" | "extensions" | "outputSink"> = {},
): Promise<IHtmlDocument> {
    const harness = await createExtensionTestHarness({
        languageService: HTML_LANGUAGE_SERVICE,
        activateEvents: [],
        configuration: { ...options.configuration, diode: { html: { bundledServerPath: SERVER } } },
        extensions: [htmlLanguageFeaturesRegistration(), ...(options.extensions ?? [])],
        ...(options.outputSink === undefined ? {} : { outputSink: options.outputSink }),
    });
    harness.host.registerDeclarativeExtension(handlebarsDeclarative());
    const filePath = harness.writeFile(fileName, content);
    const uri = Uri.file(filePath).toString();
    const languageId = HTML_LANGUAGE_SERVICE.getLanguageIdForResource(filePath) ?? "html";
    harness.group.openFile(filePath);
    await harness.host.activateByEvent(`onLanguage:${languageId}`);
    const pane = harness.group.editorGroups.groups[0].getPane(0);
    if (!(pane instanceof TextEditorPane)) throw new Error("no text editor");
    const document = () => ({ uri, languageId, versionId: documentVersion(harness, uri) });
    return {
        harness,
        editor: pane,
        uri,
        languageId,
        document,
        at: (line, character) => ({ ...document(), line, character }),
    };
}

/** The server starts on activation: the first answers can come before it is ready. */
export async function until(what: string, probe: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await probe())) {
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(200);
    }
}
