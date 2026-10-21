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

import { installVsix, listInstalledExtensions, readVsixManifest, uninstallExtension } from "./extensionInstaller.ts";

export interface IInstallFromRegistryOptions {
    readonly extensionsDir: string;
    readonly host: IHostVersions;
    /** Не задана — наивысшая совместимая. Зависимостей не касается. */
    readonly version?: string;
}

export interface IInstalledFromRegistry {
    readonly id: string;
    readonly version: string;
    readonly previous: string[];
}

export interface IDependencyInstallResult {
    /** Включая транзитивные. */
    readonly dependencies: readonly IInstalledFromRegistry[];
    /** Нет в реестре. Расширение всё равно ставится (как в VS Code) — не поднимется на активации, с тостом. */
    readonly missingDependencies: readonly string[];
}

export interface IInstallFromRegistryResult extends IInstalledFromRegistry, IDependencyInstallResult {}

/**
 * Осознанное отступление: эталонный CLI о зависимостях молчит, а это единственный
 * способ сказать, что поставилось что-то ещё и почему расширение может не подняться.
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
    readonly vsixPath: string;
    readonly manifest: Record<string, unknown>;
}

/** Не трогает `extensionsDir`. Id манифеста сверяется здесь же: реестр мог указать чужой артефакт. */
async function prepare(
    source: IExtensionRegistrySource,
    meta: IRegistryExtensionMeta,
    extensionId: string,
    host: IHostVersions,
    version: string | undefined,
    tempDir: string,
): Promise<IPreparedExtension> {
    let picked: IRegistryVersion | undefined;
    if (version !== undefined) {
        // Точная версия обходит engines (пользователь сказал «эту»), но не платформу:
        // чужой нативный бинарь бесполезен на этом хосте при любом желании.
        picked = meta.versions.find((v) => v.version === version && matchesHostPlatform(v, host));
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

    // Источник волен назвать скачанный файл одинаково для всех.
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
    return { id: extensionId, vsixPath, manifest };
}

/**
 * Как `getAllDepsAndPackExtensions` эталона. Уже установленная зависимость (любой
 * версии) не трогается. Нет в реестре — в `missing`; найдена, но поставить нельзя —
 * отказ всей установки: без неё расширение бесполезно.
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
        // Встроенного расширения VS Code в магазине нет и не будет — не ищем и не предупреждаем.
        if (visited.has(key) || installed.has(key) || isBuiltinVSCodeExtension(dep)) continue;
        visited.add(key);
        const meta = await source.getMeta(dep);
        if (meta === undefined) {
            missing.push(dep);
            continue;
        }
        let one: IPreparedExtension;
        try {
            // Регистр id — как у реестра: он же сверяется с манифестом артефакта.
            one = await prepare(source, meta, meta.id, options.host, undefined, tempDir);
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
 * Корень последним. Сбой снимает поставленное этим вызовом (rollback эталона); корень
 * снимать не приходится никогда, и прежняя его версия остаётся на месте.
 */
async function installPrepared(
    prepared: readonly IPreparedExtension[],
    extensionsDir: string,
): Promise<IInstalledFromRegistry[]> {
    const done: IInstalledFromRegistry[] = [];
    try {
        for (const one of prepared) done.push(await installVsix(one.vsixPath, extensionsDir));
        return done;
    } catch (err) {
        for (const one of done) uninstallExtension(one.id, extensionsDir);
        throw err;
    }
}

async function withTempDir<T>(run: (tempDir: string) => Promise<T>): Promise<T> {
    // В os.tmpdir(), НЕ в extensionsDir: там временные каталоги заводит сам
    // installVsix, и посторонний temp сбил бы его учёт установленных версий.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-registry-install-"));
    try {
        return await run(tempDir);
    } finally {
        // Stryker disable next-line BooleanLiteral: force прикрывает только отсутствующий каталог, а его создаёт mkdtempSync выше по функции — на этом пути подмена ненаблюдаема; флаг оставлен, чтобы сбой уборки не затирал исходную ошибку
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/**
 * Зависимости — без вопросов, как VS Code. Всё сначала готовится и только потом
 * ставится: отказ корня или зависимости диска не трогает.
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
        const root = await prepare(source, meta, extensionId, options.host, options.version, tempDir);
        const deps = await prepareDependencies(source, extensionId, root.manifest, options, tempDir);
        const installed = await installPrepared([...deps.prepared, root], options.extensionsDir);
        return {
            ...installed[installed.length - 1],
            dependencies: installed.slice(0, -1),
            missingDependencies: deps.missing,
        };
    });
}

/** Для `--install-extension foo.vsix`: отказ зависимостей расширение не снимает (у эталона — только предупреждение). */
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
