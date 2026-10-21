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
 * The vsix version is not pinned: stock extensions are tested against what is actually published —
 * if a new release breaks, we go red and fix it. Offline — `DIODE_E2E_OFFLINE=1`.
 */

export const BASEDPYRIGHT_ID = "detachhead.basedpyright";

export const PY_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".py") ? "python" : undefined),
    getLanguageDisplayName: () => undefined,
};

export const DEFS_PY = 'def greet(name: str) -> str:\n    return "hi " + name\n';
// A type error (str into int) — also the server readiness signal.
export const MAIN_PY = 'from defs import greet\n\nreply: int = greet("world")\nprint(reply)\n';

/** Silent converter crashes of the stock languageclient. */
export const CLIENT_CRASH_PATTERNS = /is not a constructor|Converting circular|Cannot read propert/i;

export interface IInstalledBasedpyright {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

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

/** A cold start of the bundled server takes tens of seconds; sleeps won't do. */
export async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 120_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(500);
    }
}
