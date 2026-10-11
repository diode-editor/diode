import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { installVsix } from "../vs/platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

import { registrationFromInstalled } from "./installedExtensionRegistration.ts";
import { fetchStockVsix } from "./stockVsix.ts";

/**
 * Общая обвязка сьютов extensionHost.terraformLsp*: НАСТОЯЩИЙ сторонний vsix
 * hashicorp.terraform (платформенный, с нативным `terraform-ls` внутри),
 * установленный штатным `installVsix`, — ни строчки нашего кода расширения.
 * Сервер работает без terraform CLI: схемы провайдеров (AWS и др.) вшиты.
 *
 * Vsix приезжает ИЗ МАГАЗИНА: реестр отдаёт запись `targetPlatform` текущей
 * платформы (политика — docs/TESTING.md «Тесты на стоковые расширения»).
 */

/** id записи в реестре; e2e и сценарии ставят его напрямую через `--install-extension`. */
export const TERRAFORM_ID = "hashicorp.terraform";

export const TF_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) => (filePath.endsWith(".tf") ? "terraform" : undefined),
    getLanguageDisplayName: () => undefined,
};

/**
 * Канонический файл: переменная и её использование (hover и F12 по
 * `var.region`), ресурс AWS со схемой из вшитых (автодополнение `ami`) и
 * лишний атрибут `bogus_attr` (диагностика «Unexpected attribute» — сигнал
 * готовности сервера). Строки 0-based: `variable` — 8, `var.region` — 14,
 * тело `aws_instance` — 18–19.
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

/**
 * Устанавливает vsix в изолированный каталог и собирает регистрацию из
 * УСТАНОВЛЕННОГО манифеста той же функцией, что приложение.
 */
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
