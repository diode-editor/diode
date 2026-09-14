import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { NULL_LANGUAGE_SERVICE, type ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import { flattenConfigDefaults } from "../vs/platform/extensions/common/configDefaults.ts";
import type { IExtensionManifest } from "../vs/platform/extensions/common/iExtensionManifest.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { fetchStockVsix } from "./stockVsix.ts";

/**
 * Общая обвязка сьютов extensionHost.eslintLsp*: НАСТОЯЩИЙ сторонний vsix
 * dbaeumer.vscode-eslint, установленный штатным `installVsix`, — ни строчки
 * нашего кода расширения. Клиент расширения спавнит бандленный eslintServer
 * (TransportKind.ipc) через стоковый vscode-languageclient; саму библиотеку
 * eslint сервер резолвит из `node_modules` ПРОЕКТА — расширение её не бандлит,
 * поэтому фикстура доносит её в воркспейс теста ({@link ensureEslintLibrary} +
 * {@link linkEslintLibrary}).
 *
 * Vsix приезжает ИЗ МАГАЗИНА — последняя опубликованная версия записи, без
 * закоммиченной фикстуры (политика — docs/TESTING.md).
 *
 * Близнецы обвязки — ruffFixture.ts / basedpyrightFixture.ts (оттуда же
 * `until` и CLIENT_CRASH_PATTERNS).
 */

/** id записи в реестре; e2e-сьюты ставят его напрямую через `--install-extension`. */
export const ESLINT_ID = "dbaeumer.vscode-eslint";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** Кэш `npm install eslint` — вне рабочего дерева, переживает прогоны. */
const ESLINT_LIB_CACHE_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-eslint-fixture");

/** Мини-сервис языков: `.js` → javascript (язык из `eslint.probe`), иначе — undefined. */
export const JS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".js") ? "javascript" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * Канонический линт-файл: неиспользуемая переменная (no-unused-vars, БЕЗ
 * автофикса) и лишняя точка с запятой (no-extra-semi, safe-автофикс) — пара
 * «остаётся после Fix All» / «уходит после Fix All» в одном файле.
 */
export const LINT_JS = "const unused = 1;;\n";

/**
 * Flat-конфиг только на core-правилах — ничего, кроме пакета `eslint`, в
 * фикстурный воркспейс не ставится.
 */
export const ESLINT_FLAT_CONFIG = 'export default [\n    { rules: { "no-unused-vars": "error", "no-extra-semi": "error" } },\n];\n';

export interface IInstalledEslint {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/**
 * Устанавливает vsix в изолированный каталог и собирает регистрацию из
 * УСТАНОВЛЕННОГО манифеста той же логикой, что приложение (`main.ts`).
 * Курируемых дефолтов у eslint нет — манифестные (`eslint.enable: true`,
 * `javascript` в `eslint.probe`, `lintTask.enable: false`) работают как есть.
 */
export async function installEslint(): Promise<IInstalledEslint> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(ESLINT_ID)).vsixPath, extensionsDir);
    const installRoot = path.join(extensionsDir, `${id}-${version}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(installRoot, "package.json"), "utf8")) as IExtensionManifest;
    return {
        registration: {
            id,
            manifest: { name: manifest.name, publisher: manifest.publisher, version: manifest.version },
            mainPath: path.resolve(installRoot, manifest.main as string),
            extensionPath: installRoot,
            configDefaults: flattenConfigDefaults(manifest.contributes?.configuration),
            activationEvents: manifest.activationEvents,
        },
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}

/**
 * Гарантирует кэшированную установку npm-пакета `eslint` (последняя версия на
 * момент первого прогона; кэш живёт до чистки node_modules — как у стоковых
 * vsix, версию не пиним) и возвращает путь к её `node_modules`.
 */
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

/**
 * Доносит библиотеку eslint до фикстурного воркспейса симлинком `node_modules`
 * — серверу расширения достаточно, чтобы `require("eslint")` резолвился вверх
 * от линтуемого файла.
 */
export function linkEslintLibrary(workspaceDir: string, nodeModules: string): void {
    fs.symlinkSync(nodeModules, path.join(workspaceDir, "node_modules"), "dir");
}
