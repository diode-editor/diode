import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

export const RUFF_ID = "charliermarsh.ruff";

/**
 * I001 (несортированные импорты), F401 (`sys`, safe-фикс) и пробелы для форматтера —
 * под дефолтный набор ruff 0.16: E711 в него больше не входит, и его фикс unsafe.
 */
export const LINT_PY = 'import sys\nimport os\n\nif os.path:\n    print( "x" )\n';

export interface IInstalledRuff {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installRuff(): Promise<IInstalledRuff> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(RUFF_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
