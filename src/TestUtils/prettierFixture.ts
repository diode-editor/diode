import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import { flattenConfigDefaults } from "../vs/platform/extensions/common/configDefaults.ts";
import type { IExtensionManifest } from "../vs/platform/extensions/common/iExtensionManifest.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { fetchStockVsix } from "./stockVsix.ts";

/**
 * Общая обвязка сьютов на стоковый `esbenp.prettier-vscode`: НАСТОЯЩИЙ сторонний
 * vsix из магазина, установленный штатным `installVsix`, — ни строчки нашего кода
 * расширения. Внутри vsix лежит сам prettier, так что сервера поднимать не надо:
 * расширение регистрирует провайдеры формата синхронно в `activate()`.
 *
 * Чем этот сток отличается от соседей (ruff/eslint/basedpyright): точка входа —
 * **ESM** (`"type": "module"` + `import … from "vscode"`), то есть обвязка
 * обязана донести `type` до регистрации, иначе хост выберет CJS-loader и
 * проверяться будет не тот путь, что в приложении.
 */

/** id записи в реестре; e2e-сьюты ставят его напрямую через `--install-extension`. */
export const PRETTIER_ID = "esbenp.prettier-vscode";

/**
 * Языковой сервис под сьюты prettier: расширение матчит документы по
 * `{ language: "markdown" }` / `{ language: "json" }`, а дефолтный
 * {@link NULL_LANGUAGE_SERVICE} зовёт всё `plaintext` — с ним ни один селектор
 * не сойдётся.
 */
const LANGUAGE_BY_EXTENSION: Partial<Record<string, string>> = {
    ".md": "markdown",
    ".json": "json",
    // `.js` — единственный язык в этих сьютах, где range-формат prettier
    // по-настоящему частичный (markdown он игнорирует, json расширяет до всего
    // документа), поэтому Format Selection проверяется на нём.
    ".js": "javascript",
};

export const PRETTIER_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => LANGUAGE_BY_EXTENSION[path.extname(filePath)],
};

/**
 * Канонические файлы-фикстуры: языки, которых не покрывает ни один наш LSP —
 * именно их дыру prettier и закрывает. Формат prettier 3.x по дефолтным
 * настройкам: markdown нормализует маркер списка в `-` и схлопывает пробелы
 * после `#`, json ставит пробелы внутри скобок.
 */
export const MESSY_MD = "#   Hello\n\n*  item one\n*  item two\n";
export const FORMATTED_MD = "# Hello\n\n- item one\n- item two\n";
export const MESSY_JSON = '{"a":1,   "b": [1,2,   3]}\n';
export const FORMATTED_JSON = '{ "a": 1, "b": [1, 2, 3] }\n';

/** Две кривые строки для Format Selection: формат одной не должен тронуть другую. */
export const MESSY_JS = "const  a   =  1\nconst  b   =  2\n";

export interface IInstalledPrettier {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/**
 * Устанавливает vsix в изолированный каталог и собирает регистрацию из
 * УСТАНОВЛЕННОГО манифеста той же логикой, что приложение (`main.ts`): манифест
 * едет целиком (из него хост берёт и `type`, и `packageJSON` каталога),
 * `configDefaults` — из `contributes.configuration`. Курируемых дефолтов
 * prettier не требует: вшитый prettier — дефолт самого расширения.
 */
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
            configDefaults: flattenConfigDefaults(manifest.contributes?.configuration),
            activationEvents: manifest.activationEvents,
        },
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
