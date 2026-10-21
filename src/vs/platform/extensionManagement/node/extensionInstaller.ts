import * as fs from "node:fs";
import * as path from "node:path";

import type * as Yauzl from "yauzl";
import type { Entry } from "yauzl";

import { loadLazyModule } from "../../../base/node/lazyModule.ts";
import { UI_LOCALE } from "../../environment/common/uiLocale.ts";
import { readExtensionDependencies } from "../../extensions/common/extensionDependencies.ts";
import {
    type INlsBundle,
    localizeManifest,
    nlsFileCandidates,
    parseNlsBundle,
} from "../../extensions/common/extensionNls.ts";

export interface IInstalledExtension {
    readonly id: string;
    readonly version: string;
    readonly dir: string;
    /** Странице расширения, поставленного мимо реестра, показать нечего, кроме манифеста. */
    readonly displayName?: string;
    readonly description?: string;
    /** Профиль берёт расширение вместе с ними (`ProfileExtensions.add`), даже если на диске они уже лежали. */
    readonly dependencies: readonly string[];
}

const EXTENSION_PREFIX = "extension/";

function requireManifestString(manifest: Record<string, unknown>, field: string, source: string): string {
    const value = manifest[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Invalid extension manifest in ${source}: missing "${field}"`);
    }
    return value;
}

/** Не `loadNlsBundle`: тот ходит через `IAssetAccess` (для builtin'ов в SEA), а installer — по физическим каталогам. */
function readNlsBundleSync(dir: string, locale: string): INlsBundle | undefined {
    for (const file of nlsFileCandidates(locale)) {
        try {
            // Декодирование явным шагом: так кодировка — наблюдаемое решение, а не
            // подсказка, которую `JSON.parse` сгладил бы, приведя Buffer к строке сам.
            return parseNlsBundle(fs.readFileSync(path.join(dir, file)).toString("utf8"));
        } catch {
            // следующий кандидат
        }
    }
    return undefined;
}

/** `displayName`/`description` — **локализованные**: в манифесте там обычно `"%displayName%"`. */
function readInstalled(extensionsDir: string): IInstalledExtension[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
    } catch {
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

        // Бандл читаем безусловно: проверка «есть ли что локализовать» сэкономила бы
        // один промах readFileSync ценой ветки, неотличимой по поведению.
        const nls = readNlsBundleSync(dir, UI_LOCALE);
        const { displayName, description } = localizeManifest(
            { displayName: manifest.displayName, description: manifest.description },
            nls,
        ).value;
        result.push({
            id: `${publisher}.${name}`,
            version,
            dir,
            // Пустое имя — не имя: карточка магазина показала бы пустую строку.
            displayName: typeof displayName === "string" && displayName.length > 0 ? displayName : undefined,
            description: typeof description === "string" ? description : undefined,
            dependencies: readExtensionDependencies(manifest),
        });
    }
    return result;
}

/** Ленивый кусок бандла (`scripts/build-lazy-chunks.mjs`): в `main.cjs` yauzl нет. */
function loadYauzl(): Promise<typeof Yauzl> {
    return loadLazyModule("yauzl", () => import("yauzl"));
}

async function extractExtensionPayload(vsixPath: string, destDir: string): Promise<void> {
    const yauzl = await loadYauzl();
    return new Promise((resolve, reject) => {
        yauzl.open(vsixPath, { lazyEntries: true }, (openErr, zipfile) => {
            if (openErr !== null) {
                reject(new Error(`Not a valid .vsix (zip) archive: ${vsixPath}`));
                return;
            }

            const destRoot = path.resolve(destDir);
            zipfile.on("error", (err: Error) => {
                reject(err);
            });
            zipfile.on("end", () => {
                resolve();
            });

            zipfile.on("entry", (entry: Entry) => {
                const name = entry.fileName;

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

                // Unix-права — в верхних 16 битах externalFileAttributes, если архив собран
                // на unix (versionMadeBy >> 8 === 3). Платформенные vsix несут нативные
                // серверы (bundled ruff): без exec-бита их spawn падает EACCES.
                const unixMode = entry.versionMadeBy >>> 8 === 3 ? entry.externalFileAttributes >>> 16 : 0;
                const executable = (unixMode & 0o111) !== 0;

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
                        // Не mode у createWriteStream: тот режется umask'ом процесса.
                        if (executable) fs.chmodSync(target, 0o755);
                        zipfile.readEntry();
                    });
                    readStream.pipe(writeStream);
                });
            });

            zipfile.readEntry();
        });
    });
}

/** Без распаковки: зависимости резолвятся до установки, чтобы их отказ не трогал диск (как `getAllDepsAndPackExtensions`). */
export async function readVsixManifest(vsixPath: string): Promise<Record<string, unknown>> {
    const yauzl = await loadYauzl();
    const malformed = (): Error =>
        new Error(`Invalid .vsix: missing or malformed extension/package.json in ${vsixPath}`);
    // Нет записи манифеста — пустой текст: разбор ниже отвергнет его той же ошибкой.
    const text = await new Promise<string>((resolve, reject) => {
        yauzl.open(vsixPath, { lazyEntries: true }, (openErr, zipfile) => {
            if (openErr !== null) {
                reject(new Error(`Not a valid .vsix (zip) archive: ${vsixPath}`));
                return;
            }
            zipfile.on("error", (err: Error) => {
                reject(err);
            });
            zipfile.on("end", () => {
                // Stryker disable next-line StringLiteral: любой не-JSON текст разбор ниже отвергнет той же ошибкой — содержимое строки ненаблюдаемо
                resolve("");
            });
            zipfile.on("entry", (entry: Entry) => {
                if (entry.fileName !== `${EXTENSION_PREFIX}package.json`) {
                    zipfile.readEntry();
                    return;
                }
                zipfile.openReadStream(entry, (streamErr, readStream) => {
                    /* v8 ignore start -- defensive: см. extractExtensionPayload */
                    // Stryker disable all: openReadStream ошибается лишь на повреждённых/неподдерживаемых записях, что не воспроизводится в тестах (та же ветка, что в extractExtensionPayload)
                    if (streamErr !== null) {
                        zipfile.close();
                        reject(streamErr);
                        return;
                    }
                    // Stryker restore all
                    /* v8 ignore stop */
                    const chunks: Buffer[] = [];
                    readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
                    // Stryker disable next-line StringLiteral,CallExpression: ошибка чтения уже открытой записи (сбой диска посреди чтения) в тестах не воспроизводится — та же защита, что в extractExtensionPayload
                    readStream.on("error", reject);
                    readStream.on("end", () => {
                        // Stryker disable next-line CallExpression: гигиена дескриптора — на Linux незакрытый архив не мешает ни чтению, ни удалению каталога; наблюдаемо разве что на Windows
                        zipfile.close();
                        resolve(Buffer.concat(chunks).toString());
                    });
                });
            });
            zipfile.readEntry();
        });
    });
    let parsed: unknown = undefined;
    try {
        parsed = JSON.parse(text);
    } catch {
        // та же ошибка, что «не объект», ниже
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw malformed();
    return parsed as Record<string, unknown>;
}

/** Старые версии сносятся только после успешной установки новой: битый `.vsix` не разрушает текущую. */
export async function installVsix(
    vsixPath: string,
    extensionsDir: string,
): Promise<{ id: string; version: string; previous: string[] }> {
    fs.mkdirSync(extensionsDir, { recursive: true });
    // Temp в том же каталоге, что и цель: rename атомарен, без EXDEV.
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
        // В temp уже лежит package.json — readInstalled принял бы его за установленную версию.
        const sameId = readInstalled(extensionsDir).filter((e) => e.id === id && e.dir !== tempDir);
        const previous = sameId.map((e) => e.version);

        if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true });
        }
        fs.renameSync(tempDir, targetDir);

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

export function listInstalledExtensions(extensionsDir: string): IInstalledExtension[] {
    return readInstalled(extensionsDir).sort((a, b) => a.id.localeCompare(b.id));
}
