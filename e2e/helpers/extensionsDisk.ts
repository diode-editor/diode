import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getBinaryPath } from "./buildOnce.ts";

/**
 * The user's view of extension management without the window: the CLI (`--install-extension`,
 * `--uninstall-extension`, `--list-extensions`) and what it leaves in the extensions directory.
 * Paths mirror `resolveUserDataPaths` — the same layout the app session uses.
 */

export interface CliResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

export async function runCli(args: readonly string[], cwd?: string): Promise<CliResult> {
    const binary = await getBinaryPath();
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], cwd });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

/** A CLI call that must succeed: a broken setup step fails loudly, not as a confusing later assertion. */
export async function cliOk(args: readonly string[]): Promise<CliResult> {
    const result = await runCli(args);
    if (result.code !== 0) {
        throw new Error(`diode ${args.join(" ")} exited ${String(result.code)}\n${result.stdout}\n${result.stderr}`);
    }
    return result;
}

export function extensionsDir(userDataDir: string): string {
    return join(userDataDir, "extensions");
}

/** Default keeps its list next to the extensions (`getDefaultProfileExtensionsLocation`). */
export function defaultProfileFile(userDataDir: string): string {
    return join(extensionsDir(userDataDir), "extensions.json");
}

export function namedProfileFile(userDataDir: string, profile: string): string {
    return join(userDataDir, "user-data", "User", "profiles", profile, "extensions.json");
}

/** A directory in `User/profiles/` is registered as a profile on the next start or CLI call. */
export function createNamedProfile(userDataDir: string, profile: string): void {
    mkdirSync(join(userDataDir, "user-data", "User", "profiles", profile), { recursive: true });
}

export interface IProfileEntry {
    readonly identifier: { readonly id: string };
    readonly version: string;
    readonly relativeLocation?: string;
}

export function readProfile(file: string): IProfileEntry[] | undefined {
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as IProfileEntry[];
}

export function writeProfile(file: string, entries: readonly IProfileEntry[]): void {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify(entries));
}

/** `<id>-<version>` directories of one id, sorted; service entries (dot-prefixed) are not versions. */
export function versionDirs(userDataDir: string, id: string): string[] {
    const dir = extensionsDir(userDataDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((name) => name.toLowerCase().startsWith(`${id.toLowerCase()}-`))
        .sort();
}

/** Directories replaced by a same-version install and not deleted yet (`DELETED_FOLDER_POSTFIX` upstream). */
export function replacedLeftovers(userDataDir: string): string[] {
    const dir = extensionsDir(userDataDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => name.endsWith(".vsctmp"));
}

export function obsoleteFile(userDataDir: string): string {
    return join(extensionsDir(userDataDir), ".obsolete");
}

/** `undefined` — no file; the spec says an empty set leaves no file behind. */
export function readObsolete(userDataDir: string): Record<string, boolean> | undefined {
    const file = obsoleteFile(userDataDir);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, boolean>;
}

export function obsoleteKeys(userDataDir: string): string[] {
    return Object.keys(readObsolete(userDataDir) ?? {}).sort();
}

/**
 * Builds a disk state the CLI cannot reach on its own (two versions side by side, a hand-written profile):
 * each `.vsix` is installed into a scratch user data dir through the real CLI and its directory copied over.
 */
export async function seedVersionDirs(
    userDataDir: string,
    scratchRoot: string,
    vsixFiles: readonly string[],
): Promise<void> {
    mkdirSync(extensionsDir(userDataDir), { recursive: true });
    for (const [i, vsix] of vsixFiles.entries()) {
        const scratch = join(scratchRoot, `seed-${String(i)}`);
        await cliOk([`--user-data-dir=${scratch}`, "--install-extension", vsix]);
        for (const name of readdirSync(extensionsDir(scratch))) {
            if (name.startsWith(".") || name === "extensions.json") continue;
            cpSync(join(extensionsDir(scratch), name), join(extensionsDir(userDataDir), name), { recursive: true });
        }
    }
}
