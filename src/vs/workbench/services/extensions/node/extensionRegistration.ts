import * as path from "node:path";

import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import { flattenConfigDefaults } from "../../../../platform/extensions/common/configDefaults.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ICommandContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/** Окружение сборки регистрации: где лежат расширения и чем их дополнить. */
export interface IExtensionRegistrationEnv {
    /** Префикс виртуального пути пользовательских расширений в ассетах (`UserExtensions/`). */
    readonly userPrefix: string;
    /** Каталог установленных пользовательских расширений на диске. */
    readonly userExtensionsDir: string;
    /** Исходник `main` встроенного расширения по виртуальному пути (под SEA файла на диске нет). */
    readBuiltinSource(virtualPath: string): Promise<string>;
    /**
     * Дефолты настроек от host'а поверх манифестных (курируемые для сторонних,
     * пути вшитого сервера для встроенных) — ниже пользовательских настроек.
     */
    configInjection(ext: IExtension): Readonly<Record<string, unknown>>;
}

/**
 * Регистрация расширения в extension host'е из его записи скана — одна на
 * приложение и тестовые фикстуры, чтобы в тесте регистрация была ровно той же,
 * что в проде. `null` — у расширения нет `main` (декларативное: темы,
 * грамматики), регистрировать в host'е нечего.
 *
 * Пользовательское грузится с диска (`mainPath`/`extensionPath`), встроенное —
 * строкой-исходником из ассетов (`source`/`filename`): subprocess компилирует его
 * в памяти через `Module._compile`, без записи на диск.
 */
export async function toExtensionRegistration(
    ext: IExtension,
    env: IExtensionRegistrationEnv,
): Promise<IExtensionRegistration | null> {
    const main = ext.manifest.main;
    if (typeof main !== "string" || main === "") return null;
    const commandMeta = collectCommandMeta(ext.manifest.contributes?.commands);
    const common = {
        id: ext.id,
        // Манифест целиком, а не тройка имя/издатель/версия: он же едет
        // расширениям как `Extension.packageJSON` в `vscode.extensions`, и соседа
        // по нему детектят не только по id (у AI-автодополнений в ходу
        // `contributes`, `categories`, `engines`).
        manifest: ext.manifest,
        configDefaults: {
            ...flattenConfigDefaults(ext.manifest.contributes?.configuration),
            ...env.configInjection(ext),
        },
        commandTitles: commandMeta.titles,
        commandCategories: commandMeta.categories,
        activationEvents: ext.manifest.activationEvents,
    };
    if (ext.isBuiltin) {
        const virtualPath = joinVirtualPath(ext.location, main);
        return {
            ...common,
            source: await env.readBuiltinSource(virtualPath),
            // Синтетический абсолютный путь-идентичность (реального файла под SEA нет).
            filename: `/${virtualPath}`,
        };
    }
    const dirName = ext.location.slice(env.userPrefix.length).replace(/\/$/, "");
    const extensionPath = path.resolve(env.userExtensionsDir, dirName);
    return { ...common, mainPath: path.resolve(extensionPath, main), extensionPath };
}

/**
 * Собирает `contributes.commands` в пару map'ов id → title и id → category:
 * заголовок нужен, чтобы прокси рантайм-команды было видно в палитре (иначе
 * команда исполнима, но не показывается), категория — чтобы палитра нарисовала
 * её префиксом подписи («Java: Switch to Standard Mode»).
 *
 * `%ключи%` здесь уже резолвнуты: манифест локализован на этапе сканирования
 * (`scanExtensions` → `localizeExtensionManifest`).
 */
export function collectCommandMeta(commands: readonly ICommandContribution[] | undefined): {
    titles?: Record<string, string>;
    categories?: Record<string, string>;
} {
    const titles: Record<string, string> = {};
    const categories: Record<string, string> = {};
    for (const cmd of commands ?? []) {
        if (typeof cmd.command !== "string" || typeof cmd.title !== "string") continue;
        titles[cmd.command] = cmd.title;
        if (typeof cmd.category === "string" && cmd.category !== "") {
            categories[cmd.command] = cmd.category;
        }
    }
    return {
        titles: Object.keys(titles).length > 0 ? titles : undefined,
        categories: Object.keys(categories).length > 0 ? categories : undefined,
    };
}
