import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

import { editorConfiguration } from "./editorConfiguration.ts";
import { explorerConfiguration } from "./explorerConfiguration.ts";
import { extensionsConfiguration } from "./extensionsConfiguration.ts";
import { filesConfiguration } from "./filesConfiguration.ts";
import { scmConfiguration } from "./scmConfiguration.ts";
import { searchConfiguration } from "./searchConfiguration.ts";
import { tasksConfiguration } from "./tasksConfiguration.ts";
import { terminalConfiguration } from "./terminalConfiguration.ts";
import { windowConfiguration } from "./windowConfiguration.ts";
import { workbenchConfiguration } from "./workbenchConfiguration.ts";

/**
 * Nodes are plain data: the schema generator (`scripts/generate-settings-schema.mjs`) bundles this file
 * for diode-settings completion.
 */
export const CONFIGURATION_CONTRIBUTIONS = [
    workbenchConfiguration,
    windowConfiguration,
    editorConfiguration,
    explorerConfiguration,
    filesConfiguration,
    scmConfiguration,
    searchConfiguration,
    terminalConfiguration,
    tasksConfiguration,
    extensionsConfiguration,
] as const satisfies readonly IConfigurationNode[];

type ValueOfType<T> = T extends "number" | "integer"
    ? number
    : T extends "boolean"
      ? boolean
      : T extends "string"
        ? string
        : T extends "array"
          ? readonly unknown[]
          : T extends "object"
            ? Readonly<Record<string, unknown>>
            : T extends "null"
              ? null
              : unknown;

type SettingValue<S> = S extends { readonly enum: readonly (infer E)[] }
    ? E
    : S extends { readonly type: readonly (infer T)[] }
      ? ValueOfType<T>
      : S extends { readonly type: infer T }
        ? ValueOfType<T>
        : unknown;

/** A key without a `default` reads `undefined` until it is set. */
type SettingOrUnset<S> = S extends { readonly default: unknown } ? SettingValue<S> : SettingValue<S> | undefined;

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/** `{ "editor.tabSize": number; "editor.wordWrap": "off" | "on" | … }`. */
export type SettingsOf<Nodes extends readonly IConfigurationNode[]> = UnionToIntersection<
    {
        [I in keyof Nodes]: {
            -readonly [K in keyof Nodes[I]["properties"]]: SettingOrUnset<Nodes[I]["properties"][K]>;
        };
    }[number]
>;

export type DiodeSettings = SettingsOf<typeof CONFIGURATION_CONTRIBUTIONS>;

declare module "../../../platform/configuration/common/iConfigurationService.ts" {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- fills the extension point with the node types
    interface IConfigurationKeys extends DiodeSettings {}
}
