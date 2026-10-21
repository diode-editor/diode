import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

export const RUFF_ID = "charliermarsh.ruff";

/**
 * I001 (unsorted imports), F401 (`sys`, safe fix) and whitespace for the formatter —
 * tuned to the ruff 0.16 default rule set: E711 is no longer in it, and its fix is unsafe.
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
