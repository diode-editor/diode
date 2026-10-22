import * as fs from "node:fs";
import * as path from "node:path";

import { isFileNotFound } from "../../../base/node/fsErrors.ts";
import type { ILogger } from "../../log/common/iLogger.ts";

/**
 * Versions no profile needs anymore are not deleted right away: a running extension host
 * may still load files from them. Like upstream `extensionManagementService.ts`, they are
 * marked in `extensions/.obsolete` (`{ "<dir name>": true }`) and deleted by
 * {@link cleanUpExtensions} when the editor starts.
 *
 * Deviation from upstream: each diode window is its own process, so a starting window
 * must not delete what another live window has loaded. Each editor process leases the
 * directories it loaded in `extensions/.inuse/<pid>.json`.
 *
 * No inter-process lock, like `extensions.json`: a CLI and a window writing at once may lose a mark.
 */

export const OBSOLETE_FILE = ".obsolete";

export const EXTENSION_LEASES_DIR = ".inuse";

/** Upstream `DELETED_FOLDER_POSTFIX`: a directory renamed away before deletion. */
export const DELETED_FOLDER_POSTFIX = ".vsctmp";

const INSTALL_TEMP_PREFIX = ".vsix-install-";

/** The pid lets a cleanup tell a crashed install's leftovers from another process's install in progress. */
export function installTempPrefix(pid: number = process.pid): string {
    return `${INSTALL_TEMP_PREFIX}${String(pid)}-`;
}

/** Service entries (`.obsolete`, `.inuse`, install temps) start with a dot; an extension directory never does. */
export function isExtensionDirName(name: string): boolean {
    return !name.startsWith(".") && !name.endsWith(DELETED_FOLDER_POSTFIX);
}

/** Through a temp file and `rename`, like `writeProfileExtensions`: an interruption can't leave truncated JSON. */
function writeJsonAtomic(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${String(process.pid)}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, file);
}

function obsoleteFile(extensionsDir: string): string {
    return path.join(extensionsDir, OBSOLETE_FILE);
}

/** `undefined` means no file. */
function readObsoleteRecord(extensionsDir: string): Record<string, unknown> | undefined {
    const file = obsoleteFile(extensionsDir);
    let text: string;
    try {
        text = fs.readFileSync(file).toString("utf8");
    } catch (err) {
        if (isFileNotFound(err)) return undefined;
        throw err;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        // same error as "not an object" below
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Invalid ${file}`);
    }
    return parsed as Record<string, unknown>;
}

/** Only `true` counts, like upstream. */
function marksOf(record: Record<string, unknown>): Set<string> {
    return new Set(Object.keys(record).filter((name) => record[name] === true));
}

/** A broken file is an error: the caller decides whether to delete anything. */
export function readObsolete(extensionsDir: string): ReadonlySet<string> {
    return marksOf(readObsoleteRecord(extensionsDir) ?? {});
}

/** Upstream `withRemovedExtensions` also starts over from a broken file: marks are only a hint for cleanup. */
function updateObsolete(extensionsDir: string, update: (marked: Set<string>) => boolean): void {
    let marked: Set<string>;
    try {
        marked = new Set(readObsolete(extensionsDir));
    } catch {
        marked = new Set();
    }
    if (!update(marked)) return;
    if (marked.size > 0) {
        writeJsonAtomic(obsoleteFile(extensionsDir), Object.fromEntries([...marked].map((name) => [name, true])));
    } else {
        // Stryker disable next-line ObjectLiteral,BooleanLiteral: an update that empties the set had a mark to remove, so the file exists; `force` is a guard against a concurrent delete
        fs.rmSync(obsoleteFile(extensionsDir), { force: true });
    }
}

/** Upstream `setExtensionsForRemoval`. */
export function markObsolete(extensionsDir: string, names: readonly string[]): void {
    if (names.length === 0) return;
    updateObsolete(extensionsDir, (marked) => {
        for (const name of names) marked.add(name);
        return true;
    });
}

/** Upstream `unsetExtensionsForRemoval`; returns the names that were marked. */
export function unmarkObsolete(extensionsDir: string, names: readonly string[]): string[] {
    const unmarked: string[] = [];
    updateObsolete(extensionsDir, (marked) => {
        for (const name of names) if (marked.delete(name)) unmarked.push(name);
        return unmarked.length > 0;
    });
    return unmarked;
}

function leaseFile(extensionsDir: string, pid: number): string {
    return path.join(extensionsDir, EXTENSION_LEASES_DIR, `${String(pid)}.json`);
}

/** The directories this editor process loaded; held until {@link releaseExtensionLease} or the process dies. */
export function writeExtensionLease(extensionsDir: string, names: readonly string[], pid: number = process.pid): void {
    writeJsonAtomic(leaseFile(extensionsDir, pid), names);
}

export function releaseExtensionLease(extensionsDir: string, pid: number = process.pid): void {
    fs.rmSync(leaseFile(extensionsDir, pid), { force: true });
}

/** Signal 0 only checks the process exists; `EPERM` means it exists but belongs to someone else. */
export function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as { code?: unknown }).code === "EPERM";
    }
}

const LEASE_FILE = /^(\d+)\.json$/u;

/** `undefined` protects everything: a live process whose lease can't be read may hold any directory. */
function leasedDirs(
    extensionsDir: string,
    isAlive: (pid: number) => boolean,
    logger: ILogger,
): ReadonlySet<unknown> | undefined {
    const dir = path.join(extensionsDir, EXTENSION_LEASES_DIR);
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return new Set();
    }
    // Not narrowed to strings: a foreign value in a lease can only protect a directory name equal to it.
    const leased = new Set<unknown>();
    for (const name of names) {
        const match = LEASE_FILE.exec(name);
        if (match === null) continue;
        const file = path.join(dir, name);
        if (!isAlive(Number(match[1]))) {
            // Stryker disable next-line ObjectLiteral,BooleanLiteral: the file was just listed; `force` is a guard against a concurrent delete
            fs.rmSync(file, { force: true });
            continue;
        }
        let parsed: unknown;
        try {
            // Stryker disable next-line StringLiteral: without an encoding JSON.parse reads the Buffer as the same utf-8
            parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
            // same as "not an array" below
        }
        if (!Array.isArray(parsed)) {
            logger.warn(`Unreadable extension lease ${file}; nothing is deleted`);
            return undefined;
        }
        for (const entry of parsed) leased.add(entry);
    }
    return leased;
}

const INSTALL_TEMP = /^\.vsix-install-(\d+)-/u;

/**
 * Leftovers of interrupted installs and deletions (upstream `removeTemporarilyDeletedFolders`); returns the
 * names of extension directories (with a manifest), for the orphan check.
 */
function sweepLeftovers(extensionsDir: string, isAlive: (pid: number) => boolean, logger: ILogger): string[] {
    const extensionDirs: string[] = [];
    for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (isExtensionDirName(entry.name)) {
            if (fs.existsSync(path.join(extensionsDir, entry.name, "package.json"))) extensionDirs.push(entry.name);
            continue;
        }
        const temp = INSTALL_TEMP.exec(entry.name);
        const leftover = entry.name.endsWith(DELETED_FOLDER_POSTFIX) || (temp !== null && !isAlive(Number(temp[1])));
        if (!leftover) continue;
        try {
            // Stryker disable next-line BooleanLiteral: the directory was just listed; `force` is a guard against a concurrent delete
            fs.rmSync(path.join(extensionsDir, entry.name), { recursive: true, force: true });
        } catch (err) {
            logger.warn(`Failed to delete ${entry.name}`, err);
        }
    }
    return extensionDirs;
}

export interface ICleanUpExtensionsOptions {
    /** Directory names the profiles point to. */
    readonly referencedDirs: () => ReadonlySet<string>;
    readonly logger: ILogger;
    readonly isAlive?: (pid: number) => boolean;
}

/**
 * Upstream `deleteExtensionsMarkedForRemoval` plus `deleteExtensionsNotInProfiles`, run by the editor (not the
 * CLI) before scanning extensions: deletes the marked directories no profile points to and no live window has
 * leased, then marks the directories no profile points to (left by a crashed install, copied by hand). Those are
 * deleted on the next start, not now: an install in another process writes its profile entry right after
 * unpacking. Never throws past a failure: the window starts with whatever is left. Returns the deleted names.
 */
export function cleanUpExtensions(extensionsDir: string, options: ICleanUpExtensionsOptions): string[] {
    const { logger } = options;
    const isAlive = options.isAlive ?? isProcessAlive;
    let record: Record<string, unknown> | undefined;
    try {
        record = readObsoleteRecord(extensionsDir);
    } catch (err) {
        logger.error("Failed to read extensions marked for removal; nothing is deleted", err);
        return [];
    }
    // Stryker disable next-line ConditionalExpression: without the directory the profiles point to nothing and the listing below fails the same way; this only saves reading them
    if (!fs.existsSync(extensionsDir)) return [];
    let referenced: ReadonlySet<string>;
    try {
        referenced = options.referencedDirs();
    } catch (err) {
        logger.error("Failed to read profile extensions; nothing is deleted", err);
        return [];
    }
    const leased = leasedDirs(extensionsDir, isAlive, logger);

    // Stryker disable next-line ArrayDeclaration: unmarking a key that is not in the file changes nothing
    const handled: string[] = [];
    const deleted: string[] = [];
    const marked = marksOf(record ?? {});
    for (const name of marked) {
        if (name !== path.basename(name) || name === "." || name === ".." || name.length === 0) {
            logger.warn(`Ignoring invalid entry in ${OBSOLETE_FILE}: ${name}`);
            handled.push(name);
            continue;
        }
        if (referenced.has(name)) {
            logger.info(`Extension ${name} is used by a profile again; not deleting it`);
            handled.push(name);
            continue;
        }
        if (leased === undefined || leased.has(name)) continue;
        try {
            fs.rmSync(path.join(extensionsDir, name), { recursive: true, force: true });
        } catch (err) {
            logger.warn(`Failed to delete extension ${name}; will retry on next start`, err);
            continue;
        }
        handled.push(name);
        deleted.push(name);
    }
    // Only the handled keys: another process may have marked something meanwhile.
    unmarkObsolete(extensionsDir, handled);
    if (deleted.length > 0) logger.info("Deleted extensions marked for removal", { deleted });
    const orphans = sweepLeftovers(extensionsDir, isAlive, logger).filter(
        (name) => !referenced.has(name) && !marked.has(name),
    );
    if (orphans.length > 0) {
        markObsolete(extensionsDir, orphans);
        logger.info("Extensions no profile uses are marked for removal on next start", { orphans });
    }
    return deleted;
}
