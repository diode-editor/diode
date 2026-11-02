import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

export const YAML_ID = "redhat.vscode-yaml";

/** The extension asks about Red Hat telemetry with a toast on start; the smoke and suites turn it off. */
export const YAML_SETTINGS = { "redhat.telemetry.enabled": false } as const;

export const YAML_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (/\.ya?ml$/.test(filePath) ? "yaml" : undefined),
};

/** A schema next to the document: the modeline resolves it without the network. */
export const PERSON_SCHEMA = JSON.stringify({
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Person",
    type: "object",
    additionalProperties: false,
    properties: {
        name: { type: "string", description: "Full name of the person" },
        role: { enum: ["admin", "guest"], description: "Access level" },
    },
});

export interface IInstalledYaml {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installYaml(): Promise<IInstalledYaml> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const vsixPath = process.env.YAML_VSIX ?? (await fetchStockVsix(YAML_ID)).vsixPath;
    const { id, version } = await installVsix(vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
