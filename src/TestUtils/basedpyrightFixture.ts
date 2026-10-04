import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";
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

/** id записи в реестре; e2e-сьюты ставят его напрямую через `--install-extension`. */
export const BASEDPYRIGHT_ID = "detachhead.basedpyright";

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
 * УСТАНОВЛЕННОГО манифеста той же функцией, что приложение (`toExtensionRegistration`);
 * дефолты настроек харнесс берёт из манифеста + курируемый importStrategy (манифестный
 * `fromEnvironment` требует расширения ms-python.python и роняет activate —
 * см. curatedConfigInjection в main.ts).
 */
export async function installBasedpyright(): Promise<IInstalledBasedpyright> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(BASEDPYRIGHT_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
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
