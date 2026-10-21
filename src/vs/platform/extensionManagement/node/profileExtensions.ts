import * as fs from "node:fs";
import * as path from "node:path";

import { isFileNotFound } from "../../../base/node/fsErrors.ts";
import { extensionKey } from "../../extensions/common/extensionDependencies.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { NULL_LOGGER } from "../../log/common/nullLogService.ts";

import { type IInstalledExtension, listInstalledExtensions, uninstallExtension } from "./extensionInstaller.ts";

/**
 * Состав профиля (`extensionsProfileScannerService.ts` эталона): расширения лежат в
 * общем `extensions/`, а `extensions.json` профиля перечисляет включённые.
 *
 * Отступление от эталона: версия одна на все профили — `installVsix` сносит прочие
 * версии id, поэтому запись сопоставляется с диском по id, а `version` и
 * `relativeLocation` в файле справочные.
 *
 * Синхронный: файлы маленькие, читают их бутстрап и CLI до подъёма TUI.
 */

export const PROFILE_EXTENSIONS_FILE = "extensions.json";

/** Подмножество `IStoredProfileExtension` эталона; чужие поля записи при перезаписи сохраняются. */
export interface IStoredProfileExtension {
    readonly identifier: { readonly id: string };
    readonly version: string;
    readonly relativeLocation?: string;
}

/** `undefined` — файла нет. Не JSON-массив — ошибка: перезапись молча стёрла бы чужой состав. */
export function readProfileExtensions(file: string): IStoredProfileExtension[] | undefined {
    let text: string;
    try {
        // Явным шагом: неверная кодировка бросает, а не сглаживается `JSON.parse`.
        text = fs.readFileSync(file).toString("utf8");
    } catch (err) {
        if (isFileNotFound(err)) return undefined;
        throw err;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        // та же ошибка, что «не массив», ниже
    }
    if (!Array.isArray(parsed)) throw new Error(`Invalid extensions profile content in ${file}`);
    return parsed.filter(isStoredProfileExtension);
}

/** Через временный файл и `rename`: обрыв посреди записи не оставит обрезанный JSON. */
export function writeProfileExtensions(file: string, entries: readonly IStoredProfileExtension[]): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${String(process.pid)}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(entries));
    fs.renameSync(temp, file);
}

function toStoredExtension(installed: IInstalledExtension): IStoredProfileExtension {
    return {
        identifier: { id: installed.id },
        version: installed.version,
        relativeLocation: path.basename(installed.dir),
    };
}

function profileKeys(file: string): Set<string> {
    return new Set((readProfileExtensions(file) ?? []).map((e) => extensionKey(e.identifier.id)));
}

/**
 * Профиль без `extensions.json` получает **все** установленные: до состава по профилю
 * они были видны в каждом. Новые профили получают пустой файл сразу
 * (`createNamedProfile`), так что сюда попадают лишь профили прошлых версий.
 */
export function migrateProfileExtensions(extensionsDir: string, profileFiles: readonly string[]): string[] {
    const missing = profileFiles.filter((file) => !fs.existsSync(file));
    // Stryker disable next-line ConditionalExpression: экономия обхода каталога расширений на каждом старте — без неё результат тот же (пустой список, ничего не записано)
    if (missing.length === 0) return [];
    const all = listInstalledExtensions(extensionsDir).map(toStoredExtension);
    for (const file of missing) writeProfileExtensions(file, all);
    return missing;
}

/** Плюс диск: реестр процесса может не знать профиль, созданный другим окном (`storage.json` — снимок). */
export function profileExtensionsFiles(known: readonly string[], profilesHome: string): string[] {
    const files = new Set(known);
    let entries: fs.Dirent[] = [];
    try {
        entries = fs.readdirSync(profilesHome, { withFileTypes: true });
    } catch {
        // именованных профилей на диске нет
    }
    for (const entry of entries) {
        if (entry.isDirectory()) files.add(path.join(profilesHome, entry.name, PROFILE_EXTENSIONS_FILE));
    }
    return [...files];
}

/** Как `deleteExtensionsNotInProfiles`. Нечитаемый файл профиля считается держащим всё. */
export function deleteUnusedExtensions(
    extensionsDir: string,
    profileFiles: readonly string[],
    candidates?: readonly string[],
): string[] {
    const used = new Set<string>();
    for (const file of profileFiles) {
        let keys: Set<string>;
        try {
            keys = profileKeys(file);
        } catch {
            return [];
        }
        for (const key of keys) used.add(key);
    }
    const only = candidates === undefined ? undefined : new Set(candidates.map(extensionKey));
    const deleted: string[] = [];
    for (const installed of listInstalledExtensions(extensionsDir)) {
        const key = extensionKey(installed.id);
        if (used.has(key) || (only !== undefined && !only.has(key))) continue;
        uninstallExtension(installed.id, extensionsDir);
        deleted.push(installed.id);
    }
    return deleted;
}

export interface IProfileExtensionsOptions {
    readonly extensionsDir: string;
    readonly profileFile: string;
    /** Включая этот. */
    readonly allProfileFiles: () => readonly string[];
    readonly logger?: ILogger;
}

export interface IProfileExtensionRemoval {
    readonly removed: boolean;
    /** Снесённые с диска: ни одному профилю больше не нужны. */
    readonly deleted: readonly string[];
}

export class ProfileExtensions {
    private readonly logger: ILogger;

    public constructor(private readonly options: IProfileExtensionsOptions) {
        this.logger = options.logger ?? NULL_LOGGER;
    }

    public get extensionsDir(): string {
        return this.options.extensionsDir;
    }

    /** Нечитаемый файл — пустой состав и ошибка в лог: окно поднимается, файл остаётся нетронутым. */
    public list(): IInstalledExtension[] {
        let keys: Set<string>;
        try {
            keys = profileKeys(this.options.profileFile);
        } catch (err) {
            this.logger.error(`Failed to read profile extensions ${this.options.profileFile}`, err);
            return [];
        }
        return listInstalledExtensions(this.options.extensionsDir).filter((e) => keys.has(extensionKey(e.id)));
    }

    /**
     * Вместе с `extensionDependencies` транзитивно: зависимость, поставленная раньше
     * для другого профиля, в этом тоже нужна. Нечитаемый файл — ошибка, не перезапись.
     */
    public add(ids: readonly string[]): void {
        const installed = new Map(
            listInstalledExtensions(this.options.extensionsDir).map((e) => [extensionKey(e.id), e]),
        );
        const adding = new Map<string, IInstalledExtension>();
        const queue = ids.map(extensionKey);
        for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
            const one = installed.get(key);
            if (one === undefined || adding.has(key)) continue;
            adding.set(key, one);
            queue.push(...one.dependencies.map(extensionKey));
        }
        const entries = (readProfileExtensions(this.options.profileFile) ?? []).filter(
            (e) => !adding.has(extensionKey(e.identifier.id)),
        );
        writeProfileExtensions(this.options.profileFile, [...entries, ...[...adding.values()].map(toStoredExtension)]);
    }

    /** Не нужно больше ни одному профилю — сносит и каталог (`onDidRemoveExtensions` эталона). */
    public remove(id: string): IProfileExtensionRemoval {
        const key = extensionKey(id);
        const entries = readProfileExtensions(this.options.profileFile) ?? [];
        const kept = entries.filter((e) => extensionKey(e.identifier.id) !== key);
        if (kept.length === entries.length) return { removed: false, deleted: [] };
        writeProfileExtensions(this.options.profileFile, kept);
        const deleted = deleteUnusedExtensions(this.options.extensionsDir, this.options.allProfileFiles(), [id]);
        if (deleted.length === 0) this.logger.info(`Extension ${id} is kept on disk: another profile uses it`);
        return { removed: true, deleted };
    }
}

function isStoredProfileExtension(value: unknown): value is IStoredProfileExtension {
    const identifier = (value as { identifier?: unknown } | null | undefined)?.identifier;
    const id = (identifier as { id?: unknown } | null | undefined)?.id;
    return typeof id === "string" && id.length > 0;
}

/** Типы структурные: установке расширений незачем знать модель профиля из `platform/userDataProfile`. */
export function createProfileExtensions(input: {
    readonly extensionsDir: string;
    readonly profile: { readonly extensionsResource: string };
    readonly profiles: {
        readonly profilesHome: string;
        readonly profiles: readonly { readonly extensionsResource: string }[];
    };
    readonly logger?: ILogger;
}): ProfileExtensions {
    const { extensionsDir, profile, profiles, logger } = input;
    return new ProfileExtensions({
        extensionsDir,
        profileFile: profile.extensionsResource,
        allProfileFiles: () =>
            profileExtensionsFiles(
                profiles.profiles.map((p) => p.extensionsResource),
                profiles.profilesHome,
            ),
        logger: logger ?? NULL_LOGGER,
    });
}
