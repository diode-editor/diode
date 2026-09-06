import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import type { Entry } from "yauzl";

/**
 * Установка/удаление расширений из `.vsix` на локальный диск.
 *
 * `.vsix` — обычный zip: полезная нагрузка лежит под каталогом `extension/`
 * (рядом — служебные `extension.vsixmanifest` и `[Content_Types].xml`, которые
 * нам не нужны). Мы распаковываем только `extension/**` во временный каталог,
 * читаем и валидируем `package.json`, затем атомарным `rename` переносим в
 * `<extensionsDir>/<publisher>.<name>-<version>/` — именно этот layout ждёт
 * {@link scanExtensions} (id/version он берёт из `package.json`, но имя каталога
 * держим по конвенции).
 *
 * Модуль намеренно чистый: только `node:fs`/`node:path`/`yauzl`, без DI/логгера/UI.
 * Печать и коды выхода — на стороне вызывающего (main.ts).
 */

/** Установленное расширение (по чтению `package.json` в подкаталоге). */
export interface IInstalledExtension {
    /** `<publisher>.<name>`. */
    readonly id: string;
    readonly version: string;
    /** Абсолютный путь к каталогу расширения. */
    readonly dir: string;
    /**
     * `displayName` манифеста, если он там есть. Нужен странице расширения,
     * поставленного мимо реестра: показать в UI нечего, кроме манифеста.
     */
    readonly displayName?: string;
    /** `description` манифеста, если он там есть (тот же случай). */
    readonly description?: string;
}

const EXTENSION_PREFIX = "extension/";

/** Валидирует, что поле манифеста — непустая строка. Иначе бросает с понятным текстом. */
function requireManifestString(manifest: Record<string, unknown>, field: string, source: string): string {
    const value = manifest[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Invalid extension manifest in ${source}: missing "${field}"`);
    }
    return value;
}

/**
 * Перечисляет установленные расширения: readdir первого уровня, для каждого
 * подкаталога читает `package.json` и извлекает id/version (как это делает
 * {@link scanExtensions}). Битые/без манифеста подкаталоги — пропускает.
 * Работает по реальным путям через `node:fs` (installer оперирует физическими
 * каталогами, а не абстракцией `IAssetAccess`).
 */
function readInstalled(extensionsDir: string): IInstalledExtension[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
    } catch {
        // Каталога ещё нет — считаем, что расширений нет.
        return [];
    }

    const result: IInstalledExtension[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(extensionsDir, entry.name);
        const manifestPath = path.join(dir, "package.json");

        let manifest: Record<string, unknown>;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        } catch {
            // Нет package.json или битый JSON — не расширение, пропускаем.
            continue;
        }

        const { publisher, name, version } = manifest;
        if (
            typeof publisher !== "string" ||
            publisher.length === 0 ||
            typeof name !== "string" ||
            name.length === 0 ||
            typeof version !== "string" ||
            version.length === 0
        ) {
            continue;
        }

        const { displayName, description } = manifest;
        result.push({
            id: `${publisher}.${name}`,
            version,
            dir,
            displayName: typeof displayName === "string" && displayName.length > 0 ? displayName : undefined,
            description: typeof description === "string" ? description : undefined,
        });
    }
    return result;
}

/**
 * Лениво загружает yauzl. yauzl — CJS и делает `require("fs")` при инициализации;
 * в ESM-бандле (SEA) esbuild оборачивает это в шим `__require`, который берёт
 * глобальный `require`, иначе бросает "Dynamic require of…". Ставим require
 * точечно — только здесь, на пути установки, — чтобы обычный старт редактора
 * не тянул yauzl и не менял глобальную область. База — `process.execPath`
 * (абсолютный путь, валиден и на Windows; резолв builtin'ов от базы не зависит).
 */
async function loadYauzl() {
    const g = globalThis as { require?: NodeJS.Require };
    if (typeof g.require === "undefined") {
        g.require = createRequire(process.execPath);
    }
    return import("yauzl");
}

/**
 * Открывает zip и распаковывает записи под `extension/` в `destDir`. Записи вне
 * `extension/` (включая `extension.vsixmanifest` и `[Content_Types].xml`) и
 * каталоги — пропускаются. Защита от zip-slip: путь, выходящий за `destDir`,
 * приводит к reject (yauzl сам отвергает `..`-имена, но guard оставлен как
 * defense-in-depth).
 */
async function extractExtensionPayload(vsixPath: string, destDir: string): Promise<void> {
    const yauzl = await loadYauzl();
    return new Promise((resolve, reject) => {
        yauzl.open(vsixPath, { lazyEntries: true }, (openErr, zipfile) => {
            if (openErr !== null) {
                reject(new Error(`Not a valid .vsix (zip) archive: ${vsixPath}`));
                return;
            }

            const destRoot = path.resolve(destDir);
            // yauzl эмитит "error" для битого архива и для имён с `..`.
            zipfile.on("error", (err: Error) => {
                reject(err);
            });
            zipfile.on("end", () => {
                resolve();
            });

            zipfile.on("entry", (entry: Entry) => {
                const name = entry.fileName;

                // Только полезная нагрузка под extension/, каталоги пропускаем.
                if (!name.startsWith(EXTENSION_PREFIX) || name.endsWith("/")) {
                    zipfile.readEntry();
                    return;
                }

                const rel = name.slice(EXTENSION_PREFIX.length);
                const target = path.resolve(destRoot, rel);

                /* v8 ignore start -- defense-in-depth: yauzl отвергает `..`-имена
                   ("error") до эмита "entry", поэтому сюда `..`-путь не доходит */
                if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
                    zipfile.close();
                    reject(new Error(`Refusing to extract entry outside target dir (zip-slip): ${name}`));
                    return;
                }
                /* v8 ignore stop */

                zipfile.openReadStream(entry, (streamErr, readStream) => {
                    /* v8 ignore start -- defensive: openReadStream ошибается лишь на
                       повреждённых/неподдерживаемых записях, что не воспроизводится в тестах */
                    if (streamErr !== null) {
                        zipfile.close();
                        reject(streamErr);
                        return;
                    }
                    /* v8 ignore stop */
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    const writeStream = fs.createWriteStream(target);
                    readStream.on("error", reject);
                    writeStream.on("error", reject);
                    writeStream.on("close", () => {
                        zipfile.readEntry();
                    });
                    readStream.pipe(writeStream);
                });
            });

            zipfile.readEntry();
        });
    });
}

/**
 * Устанавливает расширение из `.vsix` в `extensionsDir`. Распаковывает
 * `extension/**` во временный каталог, валидирует `package.json`, атомарно
 * переносит в `<extensionsDir>/<id>-<version>/` и удаляет прочие версии того же
 * id. Возвращает id/version и список ранее установленных версий этого id.
 *
 * Старые версии сносятся только после того, как новая успешно установлена, —
 * битый `.vsix` не разрушает текущую установку. При любой ошибке временный
 * каталог подчищается.
 */
export async function installVsix(
    vsixPath: string,
    extensionsDir: string,
): Promise<{ id: string; version: string; previous: string[] }> {
    fs.mkdirSync(extensionsDir, { recursive: true });
    // Temp в том же каталоге, что и цель → rename атомарен, без EXDEV.
    const tempDir = fs.mkdtempSync(path.join(extensionsDir, ".vsix-install-"));

    try {
        await extractExtensionPayload(vsixPath, tempDir);

        const manifestPath = path.join(tempDir, "package.json");
        let manifest: Record<string, unknown>;
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        } catch {
            throw new Error(`Invalid .vsix: missing or malformed extension/package.json in ${vsixPath}`);
        }

        const source = path.basename(vsixPath);
        const publisher = requireManifestString(manifest, "publisher", source);
        const name = requireManifestString(manifest, "name", source);
        const version = requireManifestString(manifest, "version", source);
        const id = `${publisher}.${name}`;

        const targetDir = path.join(extensionsDir, `${id}-${version}`);
        // Исключаем собственный temp-каталог: в нём уже лежит распакованный
        // package.json, иначе readInstalled принял бы его за установленную версию.
        const sameId = readInstalled(extensionsDir).filter((e) => e.id === id && e.dir !== tempDir);
        const previous = sameId.map((e) => e.version);

        // Целевой каталог должен отсутствовать для чистого rename.
        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
        // temp создан внутри extensionsDir → тот же ФС, rename атомарен (без EXDEV).
        fs.renameSync(tempDir, targetDir);

        // Новая версия на месте — теперь сносим прочие версии того же id.
        for (const e of sameId) {
            if (e.dir !== targetDir) {
                fs.rmSync(e.dir, { recursive: true, force: true });
            }
        }

        return { id, version, previous };
    } catch (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw error;
    }
}

/**
 * Удаляет все установленные версии расширения с данным id (`publisher.name`).
 * Возвращает список снесённых каталогов.
 */
export function uninstallExtension(id: string, extensionsDir: string): { removed: string[] } {
    const removed: string[] = [];
    for (const e of readInstalled(extensionsDir)) {
        if (e.id === id) {
            fs.rmSync(e.dir, { recursive: true, force: true });
            removed.push(e.dir);
        }
    }
    return { removed };
}

/** Возвращает установленные расширения, отсортированные по id. */
export function listInstalledExtensions(extensionsDir: string): IInstalledExtension[] {
    return readInstalled(extensionsDir).sort((a, b) => a.id.localeCompare(b.id));
}
