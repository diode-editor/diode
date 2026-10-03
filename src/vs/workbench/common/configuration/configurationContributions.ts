import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

import { editorConfiguration } from "./editorConfiguration.ts";
import { explorerConfiguration } from "./explorerConfiguration.ts";
import { filesConfiguration } from "./filesConfiguration.ts";
import { scmConfiguration } from "./scmConfiguration.ts";
import { searchConfiguration } from "./searchConfiguration.ts";
import { terminalConfiguration } from "./terminalConfiguration.ts";
import { workbenchConfiguration } from "./workbenchConfiguration.ts";

/**
 * Явный список configuration-узлов приложения — наш аналог vscode-овского
 * `Registry.as(Extensions.Configuration).registerConfiguration(...)`, без
 * import-side-effects. Из него в `main.ts` собирается `ConfigurationRegistry`
 * (defaults-слой настроек, известные ключи для валидации settings.json), а
 * генератор схемы (`scripts/generate-settings-schema.mjs`) бандлит этот файл
 * для каталога автодополнения diode-settings — узлы держим чистыми данными.
 *
 * `contributes.configuration` расширений сюда не попадает: их ключи генератор
 * собирает из манифестов отдельно (Phase 6 в docs/TODO/Extensions.md — донести
 * их и до runtime-реестра).
 */
export const CONFIGURATION_CONTRIBUTIONS = [
    workbenchConfiguration,
    editorConfiguration,
    explorerConfiguration,
    filesConfiguration,
    scmConfiguration,
    searchConfiguration,
    terminalConfiguration,
] as const satisfies readonly IConfigurationNode[];

/** Тип значения ключа по его схеме: `enum` → union литералов, иначе по `type`. */
type SettingValue<S> = S extends { readonly enum: readonly (infer E)[] }
    ? E
    : S extends { readonly type: "number" }
      ? number
      : S extends { readonly type: "boolean" }
        ? boolean
        : S extends { readonly type: "string" }
          ? string
          : S extends { readonly type: "array" }
            ? readonly unknown[]
            : S extends { readonly type: "object" }
              ? Readonly<Record<string, unknown>>
              : unknown;

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/** Ключи и типы значений всех узлов: `{ "editor.tabSize": number; "editor.wordWrap": "off" | "on" | … }`. */
export type SettingsOf<Nodes extends readonly IConfigurationNode[]> = UnionToIntersection<
    {
        [I in keyof Nodes]: { -readonly [K in keyof Nodes[I]["properties"]]: SettingValue<Nodes[I]["properties"][K]> };
    }[number]
>;

/** Настройки приложения с типами по схеме — то, что видит `IConfigurationService.get(key)`. */
export type DiodeSettings = SettingsOf<typeof CONFIGURATION_CONTRIBUTIONS>;

declare module "../../../platform/configuration/common/iConfigurationService.ts" {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- наполнение точки расширения типами узлов
    interface IConfigurationKeys extends DiodeSettings {}
}
