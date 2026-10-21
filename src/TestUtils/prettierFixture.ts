import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionManifest } from "../vs/platform/extensions/common/iExtensionManifest.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { fetchStockVsix } from "./stockVsix.ts";

/**
 * The stock entry point is ESM (`"type": "module"`): the wiring must carry `type` through to
 * registration, otherwise the host picks the CJS loader and tests a different path than the app.
 */

export const PRETTIER_ID = "esbenp.prettier-vscode";

const LANGUAGE_BY_EXTENSION: Partial<Record<string, string>> = {
    ".md": "markdown",
    ".json": "json",
    // The only one where range formatting is truly partial (markdown ignores it,
    // json widens it to the document) — Format Selection is tested on it.
    ".js": "javascript",
};

export const PRETTIER_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => LANGUAGE_BY_EXTENSION[path.extname(filePath)],
};

/** prettier 3.x formatting with default settings. */
export const MESSY_MD = "#   Hello\n\n*  item one\n*  item two\n";
export const FORMATTED_MD = "# Hello\n\n- item one\n- item two\n";
export const MESSY_JSON = '{"a":1,   "b": [1,2,   3]}\n';
export const FORMATTED_JSON = '{ "a": 1, "b": [1, 2, 3] }\n';

/** Two lines: formatting one must not touch the other. */
export const MESSY_JS = "const  a   =  1\nconst  b   =  2\n";

export interface IInstalledPrettier {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/** The whole manifest is passed: the host takes `type` from it, the harness takes setting defaults. */
export async function installPrettier(): Promise<IInstalledPrettier> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(PRETTIER_ID)).vsixPath, extensionsDir);
    const installRoot = path.join(extensionsDir, `${id}-${version}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(installRoot, "package.json"), "utf8")) as IExtensionManifest;
    /* v8 ignore start -- a stock vsix always has main; the branch is reachable only with a broken manifest */
    if (manifest.main === undefined) throw new Error(`${installRoot}: в манифесте нет main`);
    /* v8 ignore stop */
    return {
        registration: {
            id,
            manifest,
            mainPath: path.resolve(installRoot, manifest.main),
            extensionPath: installRoot,
            activationEvents: manifest.activationEvents,
        },
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
