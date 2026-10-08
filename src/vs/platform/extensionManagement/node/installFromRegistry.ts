import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { extensionKey, readExtensionDependencies } from "../../extensions/common/extensionDependencies.ts";
import type { IExtensionRegistrySource } from "../common/iExtensionRegistrySource.ts";
import type { IRegistryExtensionMeta, IRegistryVersion } from "../common/registryFormat.ts";
import {
    type IHostVersions,
    matchesHostPlatform,
    resolveCompatibleVersion,
} from "../common/resolveCompatibleVersion.ts";

import { installVsix, listInstalledExtensions, readVsixManifest, uninstallExtension } from "./extensionInstaller.ts";

/**
 * Установка расширения из реестра: мета → выбор совместимой версии →
 * артефакт → проверка sha256 → существующий {@link installVsix}; вместе с ним —
 * его `extensionDependencies`, как в VS Code.
 *
 * Модуль чистый (без DI/логгера/UI) — как `extensionInstaller.ts`; печать и
 * коды выхода на вызывающем. Источник артефакта абстрагирован
 * {@link IExtensionRegistrySource}: сегодня файловый каталог, позже HTTP.
 */

export interface IInstallFromRegistryOptions {
    readonly extensionsDir: string;
    /** Версии хоста для матчинга `engines` (см. {@link IHostVersions}). */
    readonly host: IHostVersions;
    /** Точная версия; не задана — наивысшая совместимая. Зависимостей не касается. */
    readonly version?: string;
}

/** Одно поставленное расширение: id, версия и снесённые прежние версии этого id. */
export interface IInstalledFromRegistry {
    readonly id: string;
    readonly version: string;
    readonly previous: string[];
}

/** Что поставилось вместе с расширением и чего поставить не вышло. */
export interface IDependencyInstallResult {
    /** Зависимости, которых не было и которые поставились, — включая транзитивные. */
    readonly dependencies: readonly IInstalledFromRegistry[];
    /**
     * Зависимости, которых нет в реестре. Расширение при этом поставлено (как
     * в VS Code): не поднимется оно уже на активации, с тостом о причине.
     */
    readonly missingDependencies: readonly string[];
}

/** Результат {@link installFromRegistry}: само расширение плюс его зависимости. */
export interface IInstallFromRegistryResult extends IInstalledFromRegistry, IDependencyInstallResult {}

/**
 * Строки CLI о зависимостях, поставленных вместе с `rootId`: что поставилось
 * (stdout) и каких нет в реестре (stderr). Эталонный CLI о зависимостях
 * молчит; у нас это единственный способ сказать человеку, что поставилось
 * что-то ещё и почему расширение может не подняться — отступление осознанное.
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

/** sha256 файла стримингом, hex lowercase. Экспортирован для тестов и CI-тулинга реестра. */
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

/** `1.2.0 (diode ^0.3.0, vscode ^1.90.0, linux-x64)` — для сообщения «нет совместимой версии». */
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

/** `diode 0.3.0, vscode 1.127.0, linux-x64` — хост в сообщениях об ошибках. */
function describeHost(host: IHostVersions): string {
    const parts = [`diode ${host.diode}`, `vscode ${host.vscode}`, host.targetPlatform];
    return parts.filter((part) => part !== undefined).join(", ");
}

/** Расширение, готовое к установке: артефакт скачан и сверен, манифест прочитан. */
interface IPreparedExtension {
    readonly id: string;
    readonly vsixPath: string;
    readonly manifest: Record<string, unknown>;
}

/**
 * Готовит расширение к установке, не трогая `extensionsDir`: версия →
 * артефакт в свой подкаталог `tempDir` → sha256 → манифест из `.vsix`. Id
 * манифеста сверяется с запрошенным здесь же — реестр мог указать чужой
 * артефакт, и такой не ставится вовсе.
 */
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
        // Точная версия обходит engines-матчинг (пользователь сказал «эту»), но
        // не платформу: платформенных записей одной версии несколько, и чужой
        // нативный бинарь бесполезен на этом хосте при любом желании.
        picked = meta.versions.find((v) => v.version === version && matchesHostPlatform(v, host));
        if (picked === undefined) {
            throw new Error(
                `Extension "${extensionId}" has no version ${version} for this host (${describeHost(host)}) in registry; available: ${meta.versions.map(describeVersion).join(", ")}`,
            );
        }
    } else {
        picked = resolveCompatibleVersion(meta.versions, host);
        if (picked === undefined) {
            throw new Error(
                `Extension "${extensionId}" has no version compatible with this build (${describeHost(host)}); available: ${meta.versions.map(describeVersion).join(", ")}`,
            );
        }
    }

    // Свой подкаталог на расширение: источник волен назвать скачанный файл
    // одинаково для всех.
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
 * Транзитивное замыкание `extensionDependencies` манифеста `rootManifest`,
 * которых ещё нет в `extensionsDir` (как `getAllDepsAndPackExtensions`
 * эталона): каждая подготовлена к установке. Уже установленная зависимость
 * (любой версии) не трогается; id сравниваются без учёта регистра; цикл не
 * зацикливает. Зависимости нет в реестре — она в `missing`, остальное идёт
 * дальше. Найдена, но поставить нельзя (нет совместимой версии, sha256,
 * чужой артефакт) — отказ с причиной: без неё расширение бесполезно.
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
        if (visited.has(key) || installed.has(key)) continue;
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
 * Ставит подготовленное по порядку — зависимости раньше, корень последним.
 * Сорвалась установка — снимается поставленное этим вызовом (rollback
 * эталона): зависимости по одной не нужны, а корень без них не поднимется.
 * Корень последний, поэтому снимать его не приходится никогда, и прежняя его
 * версия при сбое остаётся на месте.
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

/** Временный каталог скачивания на время `run`; убирается в любом случае. */
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
 * Устанавливает `extensionId` из `source` в `extensionsDir` вместе с его
 * `extensionDependencies` — без вопросов, как VS Code (`installExtensions` →
 * `getAllDepsAndPackExtensions`). Всё сначала готовится (версии, артефакты,
 * sha256, манифесты) и только потом ставится: отказ корня или зависимости
 * диска не трогает. Ошибки — понятными сообщениями: неизвестный id, нет
 * совместимой версии (с перечислением имеющихся и их engines), sha256
 * mismatch, артефакт чужого расширения, зависимость, которую поставить нельзя.
 * Зависимость, которой нет в реестре, установку не срывает — она в
 * `missingDependencies`.
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

/**
 * Ставит из реестра `extensionDependencies` уже поставленного мимо него
 * расширения (`--install-extension foo.vsix`), как VS Code ставит их и для
 * VSIX. Семантика та же, что у {@link installFromRegistry}, но корня нет:
 * отказ — это отказ зависимостей, само расширение остаётся (у эталона сбой
 * зависимостей при установке VSIX — только предупреждение).
 */
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
