import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

/** The terraform CLI is not needed: provider schemas (AWS etc.) are embedded in `terraform-ls`. */
export const TERRAFORM_ID = "hashicorp.terraform";

export const TF_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".tf") ? "terraform" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * `bogus_attr` yields the "Unexpected attribute" diagnostic, the server readiness signal.
 * Lines are 0-based: `variable` — 8, `var.region` — 14, the `aws_instance` body — 18–19.
 */
export const MAIN_TF = [
    "terraform {",
    "  required_providers {",
    "    aws = {",
    '      source = "hashicorp/aws"',
    "    }",
    "  }",
    "}",
    "",
    'variable "region" {',
    "  type    = string",
    '  default = "us-east-1"',
    "}",
    "",
    'provider "aws" {',
    "  region = var.region",
    "}",
    "",
    'resource "aws_instance" "web" {',
    "  bogus_attr = 1",
    "  ",
    "}",
    "",
].join("\n");

export interface IInstalledTerraform {
    readonly registration: IExtensionRegistration;
    dispose(): void;
}

export async function installTerraform(): Promise<IInstalledTerraform> {
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vsix-"));
    const { id, version } = await installVsix((await fetchStockVsix(TERRAFORM_ID)).vsixPath, extensionsDir);
    return {
        registration: await registrationFromInstalled(extensionsDir, id, version),
        dispose: (): void => {
            fs.rmSync(extensionsDir, { recursive: true, force: true });
        },
    };
}
