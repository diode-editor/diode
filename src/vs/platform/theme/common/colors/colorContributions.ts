import type { ColorContribution, ThemeKind } from "../colorRegistry.ts";
import { deriveDefaultColors } from "../colorRegistry.ts";

import { baseColors } from "./baseColors.ts";
import { chartsColors } from "./chartsColors.ts";
import { controlColors } from "./controlColors.ts";
import { diffColors } from "./diffColors.ts";
import { editorColors } from "./editorColors.ts";
import { gitColors } from "./gitColors.ts";
import { scmGraphColors } from "./scmGraphColors.ts";
import { terminalColors } from "./terminalColors.ts";
import { workbenchColors } from "./workbenchColors.ts";

/**
 * A test guards key uniqueness across groups. Dark+light defaults are required for everything read
 * via `getRequiredColor`: VS Code themes are sparse, and upstream takes the rest from the TS
 * registry, not from JSON, so themes imported verbatim lack these colors.
 */
export const COLOR_CONTRIBUTIONS = {
    ...baseColors,
    ...controlColors,
    ...editorColors,
    ...workbenchColors,
    ...gitColors,
    ...scmGraphColors,
    ...diffColors,
    ...terminalColors,
    ...chartsColors,
} as const satisfies ColorContribution;

export type WorkbenchColorKey = keyof typeof COLOR_CONTRIBUTIONS;

/** `undefined` only for keys with `defaults: null` that the theme doesn't set. */
export type IWorkbenchColors = Partial<Record<WorkbenchColorKey, number>>;

const defaultsCache = new Map<ThemeKind, Record<string, string>>();

export function defaultWorkbenchColors(kind: ThemeKind): Record<string, string> {
    let table = defaultsCache.get(kind);
    if (table === undefined) {
        table = deriveDefaultColors(COLOR_CONTRIBUTIONS, kind);
        defaultsCache.set(kind, table);
    }
    return table;
}
