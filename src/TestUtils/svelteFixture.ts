import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

export const SVELTE_ID = "svelte.svelte-vscode";

/** The sessions open only `.svelte` files: the server reads `util.ts` and the tsconfig from the disk itself. */
export const SVELTE_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: () => "svelte",
};

/** `App.svelte` (an unknown name in the markup, a component, a call into `util.ts`), `Button.svelte`, `util.ts`. */
export const SVELTE_SAMPLE_DIR = path.resolve(import.meta.dirname, "..", "..", "e2e", "fixtures", "svelteSample");

export function svelteSampleFiles(): Record<string, string> {
    return Object.fromEntries(
        fs
            .readdirSync(SVELTE_SAMPLE_DIR)
            .map((name) => [name, fs.readFileSync(path.join(SVELTE_SAMPLE_DIR, name), "utf8")]),
    );
}

export interface IInstalledSvelte {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

/** The language server, the Svelte compiler and TypeScript are bundled: nothing else to install. */
export async function installSvelte(): Promise<IInstalledSvelte> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(SVELTE_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
