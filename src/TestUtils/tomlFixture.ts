import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ILanguageService } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

const TOML_ID = "tamasfe.even-better-toml";
const BROKEN_TAIL = "\n[dep\n";
export const TOML_BROKEN_TAIL_LENGTH = BROKEN_TAIL.length - 1;

export const TOML_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".toml") ? "toml" : undefined),
};

/** Local, so the schema features do not depend on the catalog: the stock 0.21.2 cannot read today's schemastore one. */
export const TOML_SCHEMA = JSON.stringify({
    type: "object",
    properties: {
        package: {
            type: "object",
            description: "Package metadata",
            properties: {
                name: {
                    type: "string",
                    description: "The package name from the schema",
                    "x-taplo": { links: { key: "https://example.com/package-name" } },
                },
                homepage: { type: "string", description: "Project home page" },
            },
        },
    },
});

export const TOML_WITH_SCHEMA = '#:schema ./schema.json\n[package]\nname   =   "demo"\n';

/** A project whose file ends in a broken table header: {@link TOML_BROKEN_TAIL_LENGTH} Backspaces from the end remove it. */
export function writeTomlProject(dir: string): string {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "schema.json"), TOML_SCHEMA);
    const file = path.join(dir, "sample.toml");
    fs.writeFileSync(file, `${TOML_WITH_SCHEMA}${BROKEN_TAIL}`);
    return file;
}

export interface IInstalledToml {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installToml(): Promise<IInstalledToml> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(TOML_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
