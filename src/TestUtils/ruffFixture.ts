import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import { flattenConfigDefaults } from "../vs/platform/extensions/common/configDefaults.ts";
import type { IExtensionManifest } from "../vs/platform/extensions/common/iExtensionManifest.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { fetchStockVsix } from "./stockVsix.ts";

/**
 * Общая обвязка сьютов extensionHost.ruffLsp*: НАСТОЯЩИЙ сторонний vsix
 * charliermarsh.ruff (платформенный, с нативным бинарём ruff внутри),
 * установленный штатным `installVsix`, — ни строчки нашего кода расширения.
 * Расширение спавнит вшитый `ruff server` (rust, Python не нужен) и гоняет
 * pull-диагностики/формат/code actions через стоковый vscode-languageclient.
 *
 * Vsix приезжает ИЗ МАГАЗИНА: реестр отдаёт запись `targetPlatform` текущей
 * платформы (маршрут проверен установкой, см. политику в docs/TESTING.md).
 * Близнец обвязки — basedpyrightFixture.ts (оттуда же PY_LANGUAGE_SERVICE,
 * CLIENT_CRASH_PATTERNS и `until`).
 */

/** id записи в реестре; e2e-сьюты ставят его напрямую через `--install-extension`. */
export const RUFF_ID = "charliermarsh.ruff";

/**
 * Канонический линт-файл: несортированные импорты (I001), неиспользуемый
 * `sys` (F401 — safe-фикс «Remove unused import»), лишние пробелы в `print`
 * для форматтера. Подобран под ДЕФОЛТНЫЙ набор правил ruff 0.16: E711 и
 * прочая классика pycodestyle в него больше не входят, а фикс E711 — unsafe
 * (Fix All применяет только safe).
 */
export const LINT_PY = 'import sys\nimport os\n\nif os.path:\n    print( "x" )\n';

export interface IInstalledRuff {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/**
 * Устанавливает vsix в изолированный каталог и собирает регистрацию из
 * УСТАНОВЛЕННОГО манифеста той же логикой, что приложение (`main.ts`):
 * flattenConfigDefaults + курируемый дефолт `importStrategy: "useBundled"`
 * (манифестный `fromEnvironment` сканирует окружение и зависит от PATH;
 * вшитый бинарь — детерминированный native server, см. curatedConfigInjection).
 */
export async function installRuff(): Promise<IInstalledRuff> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(RUFF_ID)).vsixPath, extensionsDir);
    const installRoot = path.join(extensionsDir, `${id}-${version}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(installRoot, "package.json"), "utf8")) as IExtensionManifest;
    // Расширение без `main` активировать нечем — падаем с внятным текстом,
    // а не разыменованием undefined в глубине резолва.
    /* v8 ignore start -- у стокового vsix main есть всегда; ветка достижима только на битом манифесте */
    if (manifest.main === undefined) throw new Error(`${installRoot}: в манифесте нет main`);
    /* v8 ignore stop */
    return {
        registration: {
            id,
            manifest: { name: manifest.name, publisher: manifest.publisher, version: manifest.version },
            mainPath: path.resolve(installRoot, manifest.main),
            extensionPath: installRoot,
            configDefaults: {
                ...flattenConfigDefaults(manifest.contributes?.configuration),
                "ruff.importStrategy": "useBundled",
            },
            activationEvents: manifest.activationEvents,
        },
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
