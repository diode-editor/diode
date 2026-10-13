import * as fs from "node:fs";
import * as path from "node:path";

import { isFileNotFound } from "../../../base/node/fsErrors.ts";
import { extensionKey } from "../../extensions/common/extensionDependencies.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { NULL_LOGGER } from "../../log/common/nullLogService.ts";

import { type IInstalledExtension, listInstalledExtensions, uninstallExtension } from "./extensionInstaller.ts";

/**
 * Состав расширений профиля — `extensions.json` (аналог
 * `extensionsProfileScannerService.ts` эталона). Сами расширения лежат в общем
 * каталоге `extensions/` (`IInstalledExtension`), а файл профиля перечисляет,
 * какие из них в этом профиле включены. Default хранит свой файл в самом
 * каталоге расширений (`<extensionsDir>/extensions.json`, как
 * `getDefaultProfileExtensionsLocation` эталона), именованный профиль — в своём
 * каталоге (`User/profiles/<id>/extensions.json`).
 *
 * Отступление от эталона: версия расширения одна на все профили. Установка
 * (`installVsix`) сносит прочие версии того же id, поэтому запись профиля
 * сопоставляется с диском по id, а `version`/`relativeLocation` в файле —
 * справочные (их обновляет установка в этот профиль). Обновил расширение в
 * одном профиле — обновилось во всех, где оно есть.
 *
 * Модуль на `node:fs`, синхронный — как `extensionInstaller.ts`: файлы
 * маленькие, а читают их бутстрап и CLI до подъёма TUI.
 */

/** Имя файла состава профиля — и у Default (в каталоге расширений), и у именованного. */
export const PROFILE_EXTENSIONS_FILE = "extensions.json";

/**
 * Запись `extensions.json` — подмножество `IStoredProfileExtension` эталона:
 * `identifier.id`, `version`, `relativeLocation` (каталог в `extensions/`).
 * Чужие поля записи (`location`, `metadata` из файла эталона) при перезаписи
 * сохраняются как есть.
 */
export interface IStoredProfileExtension {
    readonly identifier: { readonly id: string };
    readonly version: string;
    readonly relativeLocation?: string;
}

/**
 * Записи `extensions.json`; `undefined` — файла нет. Не JSON-массив — ошибка:
 * перезапись такого файла молча стёрла бы чужой состав. Элементы без
 * `identifier.id` пропускаются (их и эталон не читает).
 */
export function readProfileExtensions(file: string): IStoredProfileExtension[] | undefined {
    let text: string;
    try {
        // Декодирование явным шагом: неверная кодировка бросает, а не сглаживается `JSON.parse`.
        text = fs.readFileSync(file).toString("utf8");
    } catch (err) {
        if (isFileNotFound(err)) return undefined;
        throw err;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        // Битый JSON — та же ошибка, что «не массив», ниже.
    }
    if (!Array.isArray(parsed)) throw new Error(`Invalid extensions profile content in ${file}`);
    return parsed.filter(isStoredProfileExtension);
}

/**
 * Пишет состав профиля целиком: во временный файл рядом и `rename` — обрыв
 * посреди записи не оставит профиль с обрезанным JSON. Каталог создаётся.
 */
export function writeProfileExtensions(file: string, entries: readonly IStoredProfileExtension[]): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${String(process.pid)}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(entries));
    fs.renameSync(temp, file);
}

/** Запись профиля по установленному расширению. */
function toStoredExtension(installed: IInstalledExtension): IStoredProfileExtension {
    return {
        identifier: { id: installed.id },
        version: installed.version,
        relativeLocation: path.basename(installed.dir),
    };
}

/** Ключи id, которые перечисляет файл профиля; файла нет — пусто. */
function profileKeys(file: string): Set<string> {
    return new Set((readProfileExtensions(file) ?? []).map((e) => extensionKey(e.identifier.id)));
}

/**
 * Миграция на состав по профилю: профиль без `extensions.json` получает **все**
 * установленные расширения — до этой версии они и были видны в каждом
 * профиле, и после обновления ничего не пропадает. Файл пишется один раз;
 * дальше состав профиля — только его файл. Новые профили файл получают сразу
 * (пустой — `UserDataProfilesService.createNamedProfile`), так что сюда
 * попадают лишь профили из прошлых версий. Возвращает записанные файлы.
 */
export function migrateProfileExtensions(extensionsDir: string, profileFiles: readonly string[]): string[] {
    const missing = profileFiles.filter((file) => !fs.existsSync(file));
    // Stryker disable next-line ConditionalExpression: экономия обхода каталога расширений на каждом старте — без неё результат тот же (пустой список, ничего не записано)
    if (missing.length === 0) return [];
    const all = listInstalledExtensions(extensionsDir).map(toStoredExtension);
    for (const file of missing) writeProfileExtensions(file, all);
    return missing;
}

/**
 * Файлы состава всех профилей: известные реестру плюс `extensions.json` в
 * каждом каталоге `profilesHome` на диске. Диск — потому что реестр процесса
 * может не знать профиль, созданный другим окном (`storage.json` каждый
 * процесс держит своим снимком), а снести расширение, которое тот профиль
 * держит, нельзя.
 */
export function profileExtensionsFiles(known: readonly string[], profilesHome: string): string[] {
    const files = new Set(known);
    let entries: fs.Dirent[] = [];
    try {
        entries = fs.readdirSync(profilesHome, { withFileTypes: true });
    } catch {
        // Каталога профилей нет — именованных профилей на диске нет.
    }
    for (const entry of entries) {
        if (entry.isDirectory()) files.add(path.join(profilesHome, entry.name, PROFILE_EXTENSIONS_FILE));
    }
    return [...files];
}

/**
 * Удаляет из общего каталога расширения, которых нет ни в одном профиле (как
 * `deleteExtensionsNotInProfiles` эталона); `candidates` — сузить проверку до
 * этих id. Нечитаемый файл профиля считается держащим всё: удалить то, что
 * может быть в нём, нельзя. Возвращает id удалённых.
 */
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
    /** Общий каталог установленных расширений. */
    readonly extensionsDir: string;
    /** `extensions.json` профиля, с которым работаем. */
    readonly profileFile: string;
    /** Файлы состава всех профилей (включая этот) — для решения, удалять ли расширение с диска. */
    readonly allProfileFiles: () => readonly string[];
    readonly logger?: ILogger;
}

/** Итог {@link ProfileExtensions.remove}. */
export interface IProfileExtensionRemoval {
    /** Расширение было в профиле и убрано из него. */
    readonly removed: boolean;
    /** Id, снесённые с диска (оно само): ни одному профилю расширение больше не нужно. */
    readonly deleted: readonly string[];
}

/**
 * Расширения одного профиля поверх общего каталога: что в профиле (`list`),
 * взять поставленное в профиль (`add`), убрать из профиля (`remove`). Им
 * пользуются и магазин в окне (`ExtensionsWorkbenchService`), и CLI
 * (`--install-extension`/`--uninstall-extension`/`--list-extensions`).
 */
export class ProfileExtensions {
    private readonly logger: ILogger;

    public constructor(private readonly options: IProfileExtensionsOptions) {
        this.logger = options.logger ?? NULL_LOGGER;
    }

    public get extensionsDir(): string {
        return this.options.extensionsDir;
    }

    /**
     * Установленные расширения профиля, по id. Нечитаемый файл профиля —
     * пустой состав и ошибка в лог: окно поднимается, расширения не грузятся,
     * а файл остаётся нетронутым до явной установки или удаления.
     */
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
     * Включает в профиль установленные расширения `ids` вместе с их
     * `extensionDependencies` (транзитивно, из того, что лежит на диске):
     * зависимость, поставленная раньше для другого профиля, в этом тоже нужна.
     * Запись уже включённого обновляется (версия после установки новой).
     * Нечитаемый файл профиля — ошибка, файл не перезаписывается.
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

    /**
     * Убирает расширение из профиля; если ни одному профилю оно больше не
     * нужно — сносит и его каталог (`onDidRemoveExtensions` эталона). Не было в
     * профиле — ничего не меняет.
     */
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
    // Чтение поля у примитива безопасно (`undefined`), опасны только null/undefined.
    const identifier = (value as { identifier?: unknown } | null | undefined)?.identifier;
    const id = (identifier as { id?: unknown } | null | undefined)?.id;
    return typeof id === "string" && id.length > 0;
}

/**
 * {@link ProfileExtensions} активного профиля по реестру: файлы всех профилей —
 * реестр плюс каталоги `profilesHome` на диске ({@link profileExtensionsFiles}).
 * Типы структурные — модель профиля живёт в `platform/userDataProfile`, и
 * установке расширений знать о ней больше незачем.
 */
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
        ...(logger !== undefined ? { logger } : {}),
    });
}
