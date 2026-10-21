import type { ColorContribution, ThemeKind } from "../colorRegistry.ts";
import { deriveDefaultColors } from "../colorRegistry.ts";

import { baseColors } from "./baseColors.ts";
import { controlColors } from "./controlColors.ts";
import { diffColors } from "./diffColors.ts";
import { editorColors } from "./editorColors.ts";
import { gitColors } from "./gitColors.ts";
import { scmGraphColors } from "./scmGraphColors.ts";
import { terminalColors } from "./terminalColors.ts";
import { workbenchColors } from "./workbenchColors.ts";

/**
 * Уникальность ключей между группами сторожит тест. Дефолты dark+light обязательны для всего,
 * что читается через `getRequiredColor`: темы VS Code разрежены, остальное эталон берёт из
 * TS-реестра, а не из JSON, — у дословно импортированных тем этих цветов нет.
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
} as const satisfies ColorContribution;

export type WorkbenchColorKey = keyof typeof COLOR_CONTRIBUTIONS;

/** `undefined` — только у ключей с `defaults: null`, не заданных темой. */
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
