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
 * Точка входа стока — ESM (`"type": "module"`): обвязка обязана донести `type` до
 * регистрации, иначе хост выберет CJS-loader и проверится не тот путь, что в приложении.
 */

export const PRETTIER_ID = "esbenp.prettier-vscode";

const LANGUAGE_BY_EXTENSION: Partial<Record<string, string>> = {
    ".md": "markdown",
    ".json": "json",
    // Единственный, где range-формат по-настоящему частичный (markdown его игнорирует,
    // json расширяет до документа) — Format Selection проверяется на нём.
    ".js": "javascript",
};

export const PRETTIER_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => LANGUAGE_BY_EXTENSION[path.extname(filePath)],
};

/** Формат prettier 3.x по дефолтным настройкам. */
export const MESSY_MD = "#   Hello\n\n*  item one\n*  item two\n";
export const FORMATTED_MD = "# Hello\n\n- item one\n- item two\n";
export const MESSY_JSON = '{"a":1,   "b": [1,2,   3]}\n';
export const FORMATTED_JSON = '{ "a": 1, "b": [1, 2, 3] }\n';

/** Две строки: формат одной не должен тронуть другую. */
export const MESSY_JS = "const  a   =  1\nconst  b   =  2\n";

export interface IInstalledPrettier {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/** Манифест едет целиком: из него хост берёт `type`, а харнесс — дефолты настроек. */
export async function installPrettier(): Promise<IInstalledPrettier> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(PRETTIER_ID)).vsixPath, extensionsDir);
    const installRoot = path.join(extensionsDir, `${id}-${version}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(installRoot, "package.json"), "utf8")) as IExtensionManifest;
    /* v8 ignore start -- у стокового vsix main есть всегда; ветка достижима только на битом манифесте */
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
