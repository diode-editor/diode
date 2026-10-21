import * as path from "node:path";

import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ICommandContribution } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { computeActivationEvents } from "../common/activationEvents.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

export interface IExtensionRegistrationEnv {
    readonly userPrefix: string;
    readonly userExtensionsDir: string;
    /** Под SEA файла на диске нет. */
    readBuiltinSource(virtualPath: string): Promise<string>;
}

/** Одна на приложение и тестовые фикстуры: тест регистрирует ровно как прод. `null` — декларативное расширение без `main`. */
export async function toExtensionRegistration(
    ext: IExtension,
    env: IExtensionRegistrationEnv,
): Promise<IExtensionRegistration | null> {
    const main = ext.manifest.main;
    if (typeof main !== "string" || main === "") return null;
    const commandMeta = collectCommandMeta(ext.manifest.contributes?.commands);
    const common = {
        id: ext.id,
        // Манифест целиком: он же едет расширениям как `Extension.packageJSON`, и соседа детектят
        // не только по id (AI-автодополнения смотрят `contributes`, `categories`, `engines`).
        manifest: ext.manifest,
        commandTitles: commandMeta.titles,
        commandCategories: commandMeta.categories,
        // Полный набор — объявленные плюс неявные (`contributes.commands` /
        // `languages`): хост дальше только сравнивает строки.
        activationEvents: computeActivationEvents(ext.manifest, ext.id),
    };
    if (ext.isBuiltin) {
        const virtualPath = joinVirtualPath(ext.location, main);
        return {
            ...common,
            source: await env.readBuiltinSource(virtualPath),
            filename: `/${virtualPath}`,
        };
    }
    // Хвостовой `/` локации `path.resolve` снимает сам.
    const extensionPath = path.resolve(env.userExtensionsDir, ext.location.slice(env.userPrefix.length));
    return { ...common, mainPath: path.resolve(extensionPath, main), extensionPath };
}

/** `%ключи%` уже резолвнуты: манифест локализован при сканировании. */
export function collectCommandMeta(commands: readonly ICommandContribution[] | undefined): {
    titles?: Record<string, string>;
    categories?: Record<string, string>;
} {
    if (commands === undefined) return {};
    const titles: Record<string, string> = {};
    const categories: Record<string, string> = {};
    for (const cmd of commands) {
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
