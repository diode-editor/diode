import type { ColorContribution, ThemeKind } from "../colorRegistry.ts";
import { deriveDefaultColors } from "../colorRegistry.ts";

import { baseColors } from "./baseColors.ts";
import { controlColors } from "./controlColors.ts";
import { diffColors } from "./diffColors.ts";
import { editorColors } from "./editorColors.ts";
import { gitColors } from "./gitColors.ts";
import { scmGraphColors } from "./scmGraphColors.ts";
import { workbenchColors } from "./workbenchColors.ts";

/**
 * Все определения цветов workbench-а — явный merge групп по областям (наш
 * аналог суммарного эффекта `registerColor(...)`-вызовов vscode; уникальность
 * ключей между группами сторожит тест). Новый цвет фичи = определение в группе
 * своей области: дефолты dark+light обязательны для всего, что читается через
 * `getRequiredColor` (правило docs/arch/Theme.md), `defaults: null` — для
 * genuinely-опциональных ключей, которые дают только темы.
 *
 * WHY DEFAULTS EXIST AT ALL
 * -------------------------
 * VS Code theme JSON files are intentionally sparse: they override only a
 * subset of colors, and everything else falls back to per-type defaults baked
 * into VS Code's TypeScript color registry — NOT into the theme JSON. Since we
 * import our built-in themes verbatim (`scripts/import-vscode-themes.mjs`),
 * those defaulted colors are simply absent from the imported files.
 * `WorkbenchTheme.fromThemeFile` layers the derived table UNDER a theme's own
 * colors (theme wins), so any workbench color the app reads resolves to a
 * value on every theme — exactly as it does in VS Code.
 */
export const COLOR_CONTRIBUTIONS = {
    ...baseColors,
    ...controlColors,
    ...editorColors,
    ...workbenchColors,
    ...gitColors,
    ...scmGraphColors,
    ...diffColors,
} as const satisfies ColorContribution;

/** Все зарегистрированные ключи цветов (типизация `theme.getColor`). */
export type WorkbenchColorKey = keyof typeof COLOR_CONTRIBUTIONS;

/**
 * Цвета активной темы: ключ → packed 24-bit RGB (`packRgb()`). `undefined` —
 * только у ключей с `defaults: null`, не заданных темой.
 */
export type IWorkbenchColors = Partial<Record<WorkbenchColorKey, number>>;

const defaultsCache = new Map<ThemeKind, Record<string, string>>();

/** The default workbench colors (hex strings) for a theme kind. */
export function defaultWorkbenchColors(kind: ThemeKind): Record<string, string> {
    let table = defaultsCache.get(kind);
    if (table === undefined) {
        table = deriveDefaultColors(COLOR_CONTRIBUTIONS, kind);
        defaultsCache.set(kind, table);
    }
    return table;
}
