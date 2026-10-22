import * as crypto from "node:crypto";
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

import { DELETED_FOLDER_POSTFIX, installTempPrefix, isExtensionDirName, markObsolete } from "./obsoleteExtensions.ts";

export interface IInstalledExtension {
    readonly id: string;
    readonly version: string;
    readonly dir: string;
    /** An extension installed outside the registry has nothing but its manifest to show on its page. */
    readonly displayName?: string;
    readonly description?: string;
    /** A profile takes the extension together with these (`ProfileExtensions.add`), even if they were already on disk. */
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

/** Not `loadNlsBundle`: it goes through `IAssetAccess` (for builtins in SEA), while the installer works on physical directories. */
function readNlsBundleSync(dir: string, locale: string): INlsBundle | undefined {
    for (const file of nlsFileCandidates(locale)) {
        try {
            // Explicit decoding makes the encoding an observable decision rather than a
            // hint that `JSON.parse` would smooth over by stringifying the Buffer itself.
            return parseNlsBundle(fs.readFileSync(path.join(dir, file)).toString("utf8"));
        } catch {
            // try the next candidate
        }
    }
    return undefined;
}

/** `displayName`/`description` are **localized**: the manifest usually has `"%displayName%"` there. */
function readInstalled(extensionsDir: string): IInstalledExtension[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const result: IInstalledExtension[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !isExtensionDirName(entry.name)) continue;
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

        // The bundle is read unconditionally: an "anything to localize?" check would save
        // one readFileSync miss at the cost of a behaviorally indistinguishable branch.
        const nls = readNlsBundleSync(dir, UI_LOCALE);
        const { displayName, description } = localizeManifest(
            { displayName: manifest.displayName, description: manifest.description },
            nls,
        ).value;
        result.push({
            id: `${publisher}.${name}`,
            version,
            dir,
            // An empty name is no name: the store card would show an empty string.
            displayName: typeof displayName === "string" && displayName.length > 0 ? displayName : undefined,
            description: typeof description === "string" ? description : undefined,
            dependencies: readExtensionDependencies(manifest),
        });
    }
    return result;
}

/** Lazy chunk (`scripts/build-lazy-chunks.mjs`): yauzl is not in `main.cjs`. */
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

                /* v8 ignore start -- defense-in-depth: yauzl rejects `..` names
                   ("error") before emitting "entry", so a `..` path never gets here */
                if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
                    zipfile.close();
                    reject(new Error(`Refusing to extract entry outside target dir (zip-slip): ${name}`));
                    return;
                }
                /* v8 ignore stop */

                // Unix permissions live in the upper 16 bits of externalFileAttributes when
                // the archive was built on unix (versionMadeBy >> 8 === 3). Platform vsix
                // ship native servers (bundled ruff): without the exec bit spawn fails with EACCES.
                const unixMode = entry.versionMadeBy >>> 8 === 3 ? entry.externalFileAttributes >>> 16 : 0;
                const executable = (unixMode & 0o111) !== 0;

                zipfile.openReadStream(entry, (streamErr, readStream) => {
                    /* v8 ignore start -- defensive: openReadStream fails only on
                       corrupt/unsupported entries, which tests can't reproduce */
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
                        // Not createWriteStream's mode: that one is masked by the process umask.
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

/** No extraction: dependencies resolve before install so their failure leaves the disk untouched (like `getAllDepsAndPackExtensions`). */
export async function readVsixManifest(vsixPath: string): Promise<Record<string, unknown>> {
    const yauzl = await loadYauzl();
    const malformed = (): Error =>
        new Error(`Invalid .vsix: missing or malformed extension/package.json in ${vsixPath}`);
    // No manifest entry yields empty text, which the parsing below rejects with the same error.
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
                // Stryker disable next-line StringLiteral: parsing below rejects any non-JSON text with the same error, so the string content is unobservable
                resolve("");
            });
            zipfile.on("entry", (entry: Entry) => {
                if (entry.fileName !== `${EXTENSION_PREFIX}package.json`) {
                    zipfile.readEntry();
                    return;
                }
                zipfile.openReadStream(entry, (streamErr, readStream) => {
                    /* v8 ignore start -- defensive: see extractExtensionPayload */
                    // Stryker disable all: openReadStream fails only on corrupt/unsupported entries, which tests can't reproduce (same branch as in extractExtensionPayload)
                    if (streamErr !== null) {
                        zipfile.close();
                        reject(streamErr);
                        return;
                    }
                    // Stryker restore all
                    /* v8 ignore stop */
                    const chunks: Buffer[] = [];
                    readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
                    // Stryker disable next-line StringLiteral,CallExpression: a read error on an already open entry (disk failure mid-read) can't be reproduced in tests; same guard as in extractExtensionPayload
                    readStream.on("error", reject);
                    readStream.on("end", () => {
                        // Stryker disable next-line CallExpression: descriptor hygiene; on Linux an unclosed archive blocks neither reading nor deleting the directory, observable only on Windows
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
        // same error as "not an object" below
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw malformed();
    return parsed as Record<string, unknown>;
}

export interface IInstalledVsix {
    readonly id: string;
    readonly version: string;
    readonly dir: string;
}

/**
 * Other versions of the id stay: a running extension host may still load files from them,
 * and which version a profile uses is up to `ProfileExtensions`. The same version is
 * replaced, like upstream ("Installing a VSIX extension shall replace the existing extension
 * always"); a broken `.vsix` leaves the disk as it was.
 */
export async function installVsix(vsixPath: string, extensionsDir: string): Promise<IInstalledVsix> {
    fs.mkdirSync(extensionsDir, { recursive: true });
    // Temp lives in the target's directory so rename is atomic, with no EXDEV.
    const tempDir = fs.mkdtempSync(path.join(extensionsDir, installTempPrefix()));

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
        replaceDir(tempDir, targetDir);
        return { id, version, dir: targetDir };
    } catch (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw error;
    }
}

/**
 * Upstream `deleteExtensionFromLocation`: the old directory is renamed away first, so a failed
 * rename leaves no gap; what fails to delete is left to the startup cleanup.
 */
function replaceDir(sourceDir: string, targetDir: string): void {
    if (!fs.existsSync(targetDir)) {
        fs.renameSync(sourceDir, targetDir);
        return;
    }
    const deletedName = `${path.basename(targetDir)}.${crypto.randomBytes(4).toString("hex")}${DELETED_FOLDER_POSTFIX}`;
    const deletedDir = path.join(path.dirname(targetDir), deletedName);
    fs.renameSync(targetDir, deletedDir);
    try {
        fs.renameSync(sourceDir, targetDir);
        // Stryker disable next-line BlockStatement: renaming a fresh temp into a name just freed doesn't fail in tests
    } catch (err) {
        /* v8 ignore start -- defensive: see above */
        // Stryker disable all: same, unreachable from a test
        fs.renameSync(deletedDir, targetDir);
        throw err;
        // Stryker restore all
        /* v8 ignore stop */
    }
    try {
        fs.rmSync(deletedDir, { recursive: true, force: true });
    } catch {
        markObsolete(path.dirname(targetDir), [deletedName]);
    }
}

/** Right away: for rolling back a directory an install has just created, never for a version that may be in use. */
export function deleteExtensionDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

export function listInstalledExtensions(extensionsDir: string): IInstalledExtension[] {
    return readInstalled(extensionsDir).sort((a, b) => a.id.localeCompare(b.id));
}
