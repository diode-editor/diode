import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { loadSemver } from "../../../base/common/semver.ts";
import {
    extensionKey,
    isBuiltinVSCodeExtension,
    readExtensionDependencies,
} from "../../extensions/common/extensionDependencies.ts";
import type { IExtensionRegistrySource } from "../common/iExtensionRegistrySource.ts";
import type { IRegistryExtensionMeta, IRegistryVersion } from "../common/registryFormat.ts";
import {
    type IHostVersions,
    matchesHostPlatform,
    resolveCompatibleVersion,
} from "../common/resolveCompatibleVersion.ts";

import { deleteExtensionDir, installVsix, listInstalledExtensions, readVsixManifest } from "./extensionInstaller.ts";
import { unmarkObsolete } from "./obsoleteExtensions.ts";

export interface IInstallFromRegistryOptions {
    readonly extensionsDir: string;
    readonly host: IHostVersions;
    /** Unset means the highest compatible one. Doesn't apply to dependencies. */
    readonly version?: string;
}

export interface IInstalledFromRegistry {
    readonly id: string;
    readonly version: string;
    /** For `ProfileExtensions.add`: the profile points to exactly this version. */
    readonly dir: string;
}

export interface IDependencyInstallResult {
    /** Includes transitive ones. */
    readonly dependencies: readonly IInstalledFromRegistry[];
    /** Not in the registry. The extension is installed anyway (as in VS Code) and fails to activate with a toast. */
    readonly missingDependencies: readonly string[];
}

export interface IInstallFromRegistryResult extends IInstalledFromRegistry, IDependencyInstallResult {}

/**
 * Deliberate deviation: the upstream CLI says nothing about dependencies, but this is the
 * only way to tell that something else got installed and why the extension may not activate.
 */
export function describeDependencyInstall(
    rootId: string,
    result: IDependencyInstallResult,
): { readonly info: readonly string[]; readonly warnings: readonly string[] } {
    return {
        info: result.dependencies.map((dep) => `Installed ${dep.id}@${dep.version} (dependency of ${rootId})`),
        warnings: result.missingDependencies.map(
            (dep) =>
                `Warning: ${rootId} depends on "${dep}", which is not in the registry — ${rootId} will not activate until it is installed`,
        ),
    };
}

/** hex lowercase. */
export function sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("error", reject);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => {
            resolve(hash.digest("hex"));
        });
    });
}

/** `1.2.0 (diode ^0.3.0, vscode ^1.90.0, linux-x64)` */
function describeVersion(v: IRegistryVersion): string {
    const engines = [
        v.engines.diode !== undefined ? `diode ${v.engines.diode}` : undefined,
        v.engines.vscode !== undefined ? `vscode ${v.engines.vscode}` : undefined,
        v.targetPlatform,
    ]
        .filter((part) => part !== undefined)
        .join(", ");
    return `${v.version} (${engines})`;
}

/** `diode 0.3.0, vscode 1.127.0, linux-x64` */
function describeHost(host: IHostVersions): string {
    const parts = [`diode ${host.diode}`, `vscode ${host.vscode}`, host.targetPlatform];
    return parts.filter((part) => part !== undefined).join(", ");
}

interface IPreparedExtension {
    readonly id: string;
    readonly version: string;
    readonly manifest: Record<string, unknown>;
    /** A downloaded artifact, or an intact directory of the same version already on disk. */
    readonly from: { readonly vsixPath: string } | { readonly existingDir: string };
}

/**
 * Upstream `extractUserExtension(removeIfExists = false)`: the directory of this version is reused
 * if its manifest reads and matches; a directory marked for removal too (upstream `unsetIfRemoved`).
 */
function readReusableDir(
    extensionsDir: string,
    id: string,
    version: string,
): { dir: string; manifest: Record<string, unknown> } | undefined {
    const dir = path.join(extensionsDir, `${id}-${version}`);
    let manifest: Record<string, unknown>;
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Record<string, unknown>;
    } catch {
        return undefined;
    }
    const matches = `${String(manifest.publisher)}.${String(manifest.name)}` === id && manifest.version === version;
    return matches ? { dir, manifest } : undefined;
}

/** Doesn't write to `extensionsDir`. The manifest id is checked here: the registry may point to someone else's artifact. */
async function prepare(
    source: IExtensionRegistrySource,
    meta: IRegistryExtensionMeta,
    extensionId: string,
    options: IInstallFromRegistryOptions,
    version: string | undefined,
    tempDir: string,
): Promise<IPreparedExtension> {
    const { host } = options;
    let picked: IRegistryVersion | undefined;
    if (version !== undefined) {
        // An exact version bypasses engines (the user asked for "this one"), but not the
        // platform: a foreign native binary is useless on this host no matter what.
        // On equal versions the platform record beats universal, as in `resolveCompatibleVersion`.
        const matching = meta.versions.filter((v) => v.version === version && matchesHostPlatform(v, host));
        picked = matching.find((v) => v.targetPlatform !== undefined) ?? matching[0];
        if (picked === undefined) {
            throw new Error(
                `Extension "${extensionId}" has no version ${version} for this host (${describeHost(host)}) in registry; available: ${meta.versions.map(describeVersion).join(", ")}`,
            );
        }
    } else {
        picked = resolveCompatibleVersion(meta.versions, host, await loadSemver());
        if (picked === undefined) {
            throw new Error(
                `Extension "${extensionId}" has no version compatible with this build (${describeHost(host)}); available: ${meta.versions.map(describeVersion).join(", ")}`,
            );
        }
    }

    const reusable = readReusableDir(options.extensionsDir, extensionId, picked.version);
    if (reusable !== undefined) {
        return {
            id: extensionId,
            version: picked.version,
            manifest: reusable.manifest,
            from: { existingDir: reusable.dir },
        };
    }

    // The source may give every downloaded file the same name.
    const artifactDir = fs.mkdtempSync(path.join(tempDir, "artifact-"));
    const vsixPath = await source.fetchArtifact(picked, artifactDir);

    const actualSha = await sha256File(vsixPath);
    if (actualSha !== picked.sha256) {
        throw new Error(
            `sha256 mismatch for ${extensionId}@${picked.version}: registry declares ${picked.sha256}, artifact is ${actualSha} — refusing to install`,
        );
    }

    const manifest = await readVsixManifest(vsixPath);
    const actualId = `${String(manifest.publisher)}.${String(manifest.name)}`;
    if (actualId !== extensionId) {
        throw new Error(`Registry entry "${extensionId}" points to a .vsix of "${actualId}" — refusing to install`);
    }
    return { id: extensionId, version: picked.version, manifest, from: { vsixPath } };
}

/**
 * Like upstream `getAllDepsAndPackExtensions`. An already installed dependency (any
 * version) is left alone. Missing from the registry goes to `missing`; found but not
 * installable fails the whole install, since the extension is useless without it.
 */
async function prepareDependencies(
    source: IExtensionRegistrySource,
    rootId: string,
    rootManifest: Record<string, unknown>,
    options: IInstallFromRegistryOptions,
    tempDir: string,
): Promise<{ prepared: IPreparedExtension[]; missing: string[] }> {
    const installed = new Set(listInstalledExtensions(options.extensionsDir).map((e) => extensionKey(e.id)));
    const visited = new Set<string>([extensionKey(rootId)]);
    const prepared: IPreparedExtension[] = [];
    const missing: string[] = [];
    const queue = [...readExtensionDependencies(rootManifest)];
    for (let dep = queue.shift(); dep !== undefined; dep = queue.shift()) {
        const key = extensionKey(dep);
        // Built-in VS Code extensions are not and won't be in the store: don't look them up or warn.
        if (visited.has(key) || installed.has(key) || isBuiltinVSCodeExtension(dep)) continue;
        visited.add(key);
        const meta = await source.getMeta(dep);
        if (meta === undefined) {
            missing.push(dep);
            continue;
        }
        let one: IPreparedExtension;
        try {
            // Use the registry's id casing: that's what is checked against the artifact manifest.
            one = await prepare(source, meta, meta.id, options, undefined, tempDir);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            throw new Error(`Cannot install ${rootId}: its dependency "${dep}" cannot be installed — ${reason}`, {
                cause: err,
            });
        }
        prepared.push(one);
        queue.push(...readExtensionDependencies(one.manifest));
    }
    return { prepared, missing };
}

/**
 * The root goes last. A failure deletes exactly the directories this call created (upstream
 * rollback, US-0.7); other versions of the same ids stay in place.
 */
async function installPrepared(
    prepared: readonly IPreparedExtension[],
    extensionsDir: string,
): Promise<IInstalledFromRegistry[]> {
    const done: IInstalledFromRegistry[] = [];
    // Stryker disable next-line ArrayDeclaration: rolling back a path that does not exist is a no-op `rmSync(force)`
    const created: string[] = [];
    try {
        for (const one of prepared) {
            if ("existingDir" in one.from) {
                const dir = one.from.existingDir;
                unmarkObsolete(extensionsDir, [path.basename(dir)]);
                done.push({ id: one.id, version: one.version, dir });
                continue;
            }
            const installed = await installVsix(one.from.vsixPath, extensionsDir);
            created.push(installed.dir);
            done.push(installed);
        }
        return done;
    } catch (err) {
        for (const dir of created) deleteExtensionDir(dir);
        throw err;
    }
}

async function withTempDir<T>(run: (tempDir: string) => Promise<T>): Promise<T> {
    // In os.tmpdir(), NOT extensionsDir: installVsix creates its own temp directories
    // there, and a foreign temp would confuse its tracking of installed versions.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-registry-install-"));
    try {
        return await run(tempDir);
    } finally {
        // Stryker disable next-line BooleanLiteral: force only covers a missing directory, and mkdtempSync creates it earlier in this function, so the change is unobservable here; the flag stays so a cleanup failure never masks the original error
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/**
 * Dependencies install without prompting, as in VS Code. Everything is prepared first
 * and installed only afterwards, so a root or dependency failure leaves the disk untouched.
 */
export async function installFromRegistry(
    source: IExtensionRegistrySource,
    extensionId: string,
    options: IInstallFromRegistryOptions,
): Promise<IInstallFromRegistryResult> {
    const meta = await source.getMeta(extensionId);
    if (meta === undefined) {
        throw new Error(`Extension "${extensionId}" not found in registry`);
    }
    return withTempDir(async (tempDir) => {
        const root = await prepare(source, meta, extensionId, options, options.version, tempDir);
        const deps = await prepareDependencies(source, extensionId, root.manifest, options, tempDir);
        const installed = await installPrepared([...deps.prepared, root], options.extensionsDir);
        return {
            ...installed[installed.length - 1],
            dependencies: installed.slice(0, -1),
            missingDependencies: deps.missing,
        };
    });
}

/** For `--install-extension foo.vsix`: a dependency failure doesn't uninstall the extension (upstream only warns). */
export function installDependenciesFromRegistry(
    source: IExtensionRegistrySource,
    extensionId: string,
    manifest: Record<string, unknown>,
    options: IInstallFromRegistryOptions,
): Promise<IDependencyInstallResult> {
    return withTempDir(async (tempDir) => {
        const deps = await prepareDependencies(source, extensionId, manifest, options, tempDir);
        const dependencies = await installPrepared(deps.prepared, options.extensionsDir);
        return { dependencies, missingDependencies: deps.missing };
    });
}
