import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { DIODE_VERSION } from "../vs/base/common/version.ts";
import { resolveCompatibleVersion } from "../vs/platform/extensionManagement/common/resolveCompatibleVersion.ts";
import { createRegistrySource, DEFAULT_REGISTRY_URL } from "../vs/platform/extensionManagement/node/createRegistrySource.ts";
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
    const version = resolveCompatibleVersion(meta.versions, {
        diode: DIODE_VERSION,
        vscode: VSCODE_SHIM_VERSION,
        targetPlatform: currentTargetPlatform(),
    });
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
        const staging = `${cached}.${String(process.pid)}.tmp`;
        fs.copyFileSync(artifact, staging);
        fs.renameSync(staging, cached);
        return { vsixPath: cached, version: version.version };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
