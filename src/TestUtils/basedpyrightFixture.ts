import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { DIODE_VERSION } from "../vs/base/common/version.ts";
import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { resolveCompatibleVersion } from "../vs/platform/extensionManagement/common/resolveCompatibleVersion.ts";
import { createRegistrySource, DEFAULT_REGISTRY_URL } from "../vs/platform/extensionManagement/node/createRegistrySource.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import { sha256File } from "../vs/platform/extensionManagement/node/installFromRegistry.ts";
import { flattenConfigDefaults } from "../vs/platform/extensions/common/configDefaults.ts";
import type { IExtensionManifest } from "../vs/platform/extensions/common/iExtensionManifest.ts";
import { VSCODE_SHIM_VERSION } from "../vs/workbench/api/common/vscodeShimVersion.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { settle } from "./timing.ts";

/**
 * Общая обвязка сьютов extensionHost.pythonLsp*: НАСТОЯЩИЙ сторонний vsix
 * basedpyright, установленный штатным `installVsix`, — ни строчки нашего кода
 * расширения. Клиент внутри vsix (vscode-languageclient@10) сам форкает вшитый
 * сервер (TransportKind.ipc) и обязан пережить наш vscode-стаб.
 *
 * Vsix приезжает ИЗ МАГАЗИНА (последняя совместимая версия из публичного
 * реестра), версию в репозитории не пиним: стоковые расширения тестируем
 * тем, что реально опубликовано, — обновилась запись и сломалась, значит
 * краснеем и идём чинить, а не живём на устаревшей фикстуре. Герметичность
 * здесь жертвуется сознательно (docs/TESTING.md); работа без сети —
 * `DIODE_E2E_OFFLINE=1`, сьюты пропускаются.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** id записи в реестре; e2e-сьюты ставят его напрямую через `--install-extension`. */
export const BASEDPYRIGHT_ID = "detachhead.basedpyright";

/** Кэш скачанных vsix; в node_modules — вне рабочего дерева и переживает прогоны. */
const VSIX_CACHE_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "diode-stock-vsix");

/**
 * Скачивает последнюю совместимую версию basedpyright из публичного магазина
 * тем же путём резолва, что у клиента (мета → `resolveCompatibleVersion` →
 * артефакт → `sha256`), и кэширует vsix по `<id>-<version>`. Кэш валидируется
 * по `sha256` из меты, а не по факту существования файла; забег параллельных
 * vitest-воркеров разруливается атомарным rename.
 */
export async function fetchBasedpyrightVsix(): Promise<string> {
    const source = createRegistrySource(DEFAULT_REGISTRY_URL);
    const meta = await source.getMeta(BASEDPYRIGHT_ID);
    if (meta === undefined) {
        throw new Error(`${BASEDPYRIGHT_ID} is not published in the registry at ${DEFAULT_REGISTRY_URL}`);
    }
    const version = resolveCompatibleVersion(meta.versions, { diode: DIODE_VERSION, vscode: VSCODE_SHIM_VERSION });
    if (version === undefined) {
        throw new Error(`${BASEDPYRIGHT_ID}: no version compatible with this build in the registry`);
    }
    const cached = path.join(VSIX_CACHE_DIR, `${BASEDPYRIGHT_ID}-${version.version}.vsix`);
    if (fs.existsSync(cached) && (await sha256File(cached)) === version.sha256) {
        return cached;
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-stock-vsix-"));
    try {
        const artifact = await source.fetchArtifact(version, tempDir);
        const actualSha = await sha256File(artifact);
        if (actualSha !== version.sha256) {
            throw new Error(
                `sha256 mismatch for ${BASEDPYRIGHT_ID}@${version.version}: registry declares ${version.sha256}, artifact is ${actualSha}`,
            );
        }
        fs.mkdirSync(VSIX_CACHE_DIR, { recursive: true });
        // Через свой temp внутри каталога кэша: rename атомарен только в пределах
        // одной ФС, а os.tmpdir() может жить на другой.
        const staging = `${cached}.${String(process.pid)}.tmp`;
        fs.copyFileSync(artifact, staging);
        fs.renameSync(staging, cached);
        return cached;
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/** Мини-сервис языков: `.py` → python, иначе — undefined. */
export const PY_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".py") ? "python" : undefined),
    getLanguageDisplayName: () => undefined,
};

/** Каноническая пара фикстур: определение в defs.py + ошибка типов в main.py. */
export const DEFS_PY = 'def greet(name: str) -> str:\n    return "hi " + name\n';
// Ошибка типов: greet возвращает str, а reply аннотирован int (readiness-сигнал).
export const MAIN_PY = 'from defs import greet\n\nreply: int = greet("world")\nprint(reply)\n';

/** Паттерны молчаливых падений конвертеров стокового languageclient (конвенция TS-сьютов). */
export const CLIENT_CRASH_PATTERNS = /is not a constructor|Converting circular|Cannot read propert/i;

export interface IInstalledBasedpyright {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/**
 * Устанавливает vsix в изолированный каталог и собирает регистрацию из
 * УСТАНОВЛЕННОГО манифеста той же логикой, что и приложение (`main.ts`):
 * flattenConfigDefaults + курируемый дефолт importStrategy (манифестный
 * `fromEnvironment` требует расширения ms-python.python и роняет activate —
 * см. curatedConfigInjection в main.ts).
 */
export async function installBasedpyright(): Promise<IInstalledBasedpyright> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix(await fetchBasedpyrightVsix(), extensionsDir);
    const installRoot = path.join(extensionsDir, `${id}-${version}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(installRoot, "package.json"), "utf8")) as IExtensionManifest;
    return {
        registration: {
            id,
            manifest: { name: manifest.name, publisher: manifest.publisher, version: manifest.version },
            mainPath: path.resolve(installRoot, manifest.main as string),
            extensionPath: installRoot,
            configDefaults: {
                ...flattenConfigDefaults(manifest.contributes?.configuration),
                "basedpyright.importStrategy": "useBundled",
            },
            activationEvents: manifest.activationEvents,
        },
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}

/** Опрос с дедлайном: холодный старт bundled-сервера — десятки секунд, sleep'ы не годятся. */
export async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 120_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(500);
    }
}
