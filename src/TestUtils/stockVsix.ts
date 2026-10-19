import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSemver } from "../vs/base/common/semver.ts";
import { DIODE_VERSION } from "../vs/base/common/version.ts";
import { resolveCompatibleVersion } from "../vs/platform/extensionManagement/common/resolveCompatibleVersion.ts";
import {
    createRegistrySource,
    DEFAULT_REGISTRY_URL,
} from "../vs/platform/extensionManagement/node/createRegistrySource.ts";
import { sha256File } from "../vs/platform/extensionManagement/node/installFromRegistry.ts";
import { currentTargetPlatform } from "../vs/platform/extensionManagement/node/targetPlatform.ts";
import { VSCODE_SHIM_VERSION } from "../vs/workbench/api/common/vscodeShimVersion.ts";

/**
 * Общий fetch-хелпер сьютов на стоковые расширения (docs/TESTING.md «Тесты на
 * стоковые расширения — из магазина»): скачивает последнюю совместимую версию
 * записи из публичного магазина тем же путём резолва, что у клиента (мета →
 * `resolveCompatibleVersion` → артефакт → `sha256`), и кэширует vsix по
 * `<id>-<version>`. Кэш валидируется по `sha256` из меты, а не по факту
 * существования файла; забег параллельных vitest-воркеров разруливается
 * атомарным rename.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Кэш скачанных vsix; в node_modules — вне рабочего дерева и переживает прогоны. */
const VSIX_CACHE_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-stock-vsix");

export interface IStockVsix {
    /** Путь к скачанному (или закэшированному) vsix. */
    readonly vsixPath: string;
    /** Версия, которую отдал резолв, — последняя совместимая с этим билдом. */
    readonly version: string;
}

export async function fetchStockVsix(id: string): Promise<IStockVsix> {
    const source = createRegistrySource(DEFAULT_REGISTRY_URL);
    const meta = await source.getMeta(id);
    if (meta === undefined) {
        throw new Error(`${id} is not published in the registry at ${DEFAULT_REGISTRY_URL}`);
    }
    const version = resolveCompatibleVersion(
        meta.versions,
        {
            diode: DIODE_VERSION,
            vscode: VSCODE_SHIM_VERSION,
            targetPlatform: currentTargetPlatform(),
        },
        await loadSemver(),
    );
    if (version === undefined) {
        throw new Error(`${id}: no version compatible with this build in the registry`);
    }
    // Платформенный vsix кэшируется под своим таргетом: общий кэш может жить
    // в примонтированном node_modules, который переживает смену платформы.
    const platformSuffix = version.targetPlatform === undefined ? "" : `@${version.targetPlatform}`;
    const cached = path.join(VSIX_CACHE_DIR, `${id}-${version.version}${platformSuffix}.vsix`);
    if (fs.existsSync(cached) && (await sha256File(cached)) === version.sha256) {
        return { vsixPath: cached, version: version.version };
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-stock-vsix-"));
    try {
        const artifact = await source.fetchArtifact(version, tempDir);
        const actualSha = await sha256File(artifact);
        if (actualSha !== version.sha256) {
            throw new Error(
                `sha256 mismatch for ${id}@${version.version}: registry declares ${version.sha256}, artifact is ${actualSha}`,
            );
        }
        fs.mkdirSync(VSIX_CACHE_DIR, { recursive: true });
        // Через свой temp внутри каталога кэша: rename атомарен только в пределах
        // одной ФС, а os.tmpdir() может жить на другой.
        //
        // Случайный суффикс, а НЕ один `process.pid`: воркеры vitest — это потоки
        // ОДНОГО процесса, и два сьюта, тянущие одно расширение одновременно,
        // получали одинаковое имя. Первый переименовывал, второй падал на
        // `ENOENT: rename …vsix.<pid>.tmp` — поймано красным dry run мутационного
        // гейта, когда java-сьютов стало два.
        const staging = `${cached}.${String(process.pid)}.${randomBytes(6).toString("hex")}.tmp`;
        fs.copyFileSync(artifact, staging);
        fs.renameSync(staging, cached);
        return { vsixPath: cached, version: version.version };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

const OPEN_VSX_API = "https://open-vsx.org/api";

/**
 * Мост до записи в реестре: расширение, которого в магазине ещё нет, берётся
 * последней universal-версией с Open VSX (та же политика «версию не пиним»,
 * `sha256` — из файла рядом с артефактом). Появилась запись — резолв уходит в
 * реестр сам, и мост для этого id можно удалять. Сейчас им пользуется
 * `golang.go` (запись — задача A7 в docs/TODO/GoLSP.md).
 */
export async function fetchStockVsixOrOpenVsx(id: string): Promise<IStockVsix> {
    const meta = await createRegistrySource(DEFAULT_REGISTRY_URL).getMeta(id);
    if (meta !== undefined) return fetchStockVsix(id);

    const [namespace, name] = id.split(".", 2);
    const info = JSON.parse(await fetchText(`${OPEN_VSX_API}/${namespace}/${name}`)) as {
        version: string;
        files: { download: string; sha256: string };
    };
    const cached = path.join(VSIX_CACHE_DIR, `${id}-${info.version}.openvsx.vsix`);
    const expectedSha = (await fetchText(info.files.sha256)).trim().split(/\s+/)[0];
    if (fs.existsSync(cached) && (await sha256File(cached)) === expectedSha) {
        return { vsixPath: cached, version: info.version };
    }
    const response = await fetch(info.files.download);
    if (!response.ok) throw new Error(`${id}: open-vsx download failed (${String(response.status)})`);
    fs.mkdirSync(VSIX_CACHE_DIR, { recursive: true });
    // Тот же атомарный rename, что у реестрового пути (параллельные воркеры).
    const staging = `${cached}.${String(process.pid)}.${randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(staging, Buffer.from(await response.arrayBuffer()));
    const actualSha = await sha256File(staging);
    if (actualSha !== expectedSha) {
        fs.rmSync(staging, { force: true });
        throw new Error(
            `sha256 mismatch for ${id}@${info.version} from open-vsx: expected ${expectedSha}, got ${actualSha}`,
        );
    }
    fs.renameSync(staging, cached);
    return { vsixPath: cached, version: info.version };
}

async function fetchText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GET ${url} failed (${String(response.status)})`);
    return response.text();
}
