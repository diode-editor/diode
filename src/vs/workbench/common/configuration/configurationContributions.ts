import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

import { editorConfiguration } from "./editorConfiguration.ts";
import { explorerConfiguration } from "./explorerConfiguration.ts";
import { filesConfiguration } from "./filesConfiguration.ts";
import { scmConfiguration } from "./scmConfiguration.ts";
import { terminalConfiguration } from "./terminalConfiguration.ts";
import { workbenchConfiguration } from "./workbenchConfiguration.ts";

/**
 * Явный список configuration-узлов приложения — наш аналог vscode-овского
 * `Registry.as(Extensions.Configuration).registerConfiguration(...)`, без
 * import-side-effects. Из него в `main.ts` собирается `ConfigurationRegistry`
 * (defaults-слой настроек, известные ключи для валидации settings.json), а
 * генератор схемы (`scripts/generate-settings-schema.mjs`) бандлит этот файл
 * для каталога автодополнения vexx-settings — узлы держим чистыми данными.
 *
 * `contributes.configuration` расширений сюда не попадает: их ключи генератор
 * собирает из манифестов отдельно (Phase 6 в docs/TODO/Extensions.md — донести
 * их и до runtime-реестра).
 */
export const CONFIGURATION_CONTRIBUTIONS: readonly IConfigurationNode[] = [
    workbenchConfiguration,
    editorConfiguration,
    explorerConfiguration,
    filesConfiguration,
    scmConfiguration,
    terminalConfiguration,
];
