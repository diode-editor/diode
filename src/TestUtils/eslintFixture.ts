import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

/**
 * Библиотеку eslint сервер расширения резолвит из `node_modules` проекта — vsix её
 * не бандлит, поэтому фикстура доносит её в воркспейс ({@link linkEslintLibrary}).
 */

export const ESLINT_ID = "dbaeumer.vscode-eslint";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ESLINT_LIB_CACHE_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-eslint-fixture");

export const JS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".js") ? "javascript" : undefined),
    getLanguageDisplayName: () => undefined,
};

/** no-unused-vars без автофикса и no-extra-semi с ним: «остаётся» и «уходит» после Fix All. */
export const LINT_JS = "const unused = 1;;\n";

/** Только core-правила — кроме пакета `eslint`, в воркспейс ничего не ставится. */
export const ESLINT_FLAT_CONFIG =
    'export default [\n    { rules: { "no-unused-vars": "error", "no-extra-semi": "error" } },\n];\n';

export interface IInstalledEslint {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installEslint(): Promise<IInstalledEslint> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(ESLINT_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}

/** Версию не пиним — как у стоковых vsix; кэш живёт до чистки node_modules. */
export function ensureEslintLibrary(): string {
    const nodeModules = path.join(ESLINT_LIB_CACHE_DIR, "node_modules");
    if (fs.existsSync(path.join(nodeModules, "eslint", "package.json"))) return nodeModules;
    fs.mkdirSync(path.dirname(ESLINT_LIB_CACHE_DIR), { recursive: true });
    const staging = fs.mkdtempSync(`${ESLINT_LIB_CACHE_DIR}.`);
    fs.writeFileSync(path.join(staging, "package.json"), '{ "private": true }\n');
    execFileSync("npm", ["install", "eslint", "--no-audit", "--no-fund", "--loglevel=error"], {
        cwd: staging,
        stdio: "pipe",
        timeout: 180_000,
    });
    try {
        fs.renameSync(staging, ESLINT_LIB_CACHE_DIR);
    } catch {
        // Параллельный воркер успел первым — его установка ничем не хуже.
        fs.rmSync(staging, { recursive: true, force: true });
    }
    return nodeModules;
}

export function linkEslintLibrary(workspaceDir: string, nodeModules: string): void {
    fs.symlinkSync(nodeModules, path.join(workspaceDir, "node_modules"), "dir");
}
