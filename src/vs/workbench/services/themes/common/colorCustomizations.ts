import { DEFAULT_COLOR_CONFIG_VALUE } from "../../../../platform/theme/common/colorRegistry.ts";
import { isHexColor } from "../../../../platform/theme/common/colorUtils.ts";

export const COLOR_CUSTOMIZATIONS_SETTING = "workbench.colorCustomizations";

/** Upstream `themeScopeRegex`: `[A][B]` names two themes. */
const THEME_SCOPE_REGEX = /\[(.+?)\]/g;

function isThemeScope(key: string): boolean {
    return key.startsWith("[") && key.endsWith("]");
}

function isColorValue(value: unknown): value is string {
    return value === DEFAULT_COLOR_CONFIG_VALUE || isHexColor(value);
}

function isBlock(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Upstream `ColorThemeData.isThemeScopeMatch`: exact, or `*` at the start, the end or both ends as a wildcard. */
function isThemeScopeMatch(scope: string, themeId: string): boolean {
    const first = scope.charAt(0);
    const last = scope.charAt(scope.length - 1);
    return (
        scope === themeId ||
        (first === "*" && last === "*" && themeId.includes(scope.slice(1, -1))) ||
        (last === "*" && themeId.startsWith(scope.slice(0, -1))) ||
        (first === "*" && themeId.endsWith(scope.slice(1)))
    );
}

function scopeMatches(key: string, themeId: string): boolean {
    return [...key.matchAll(THEME_SCOPE_REGEX)].some((match) => isThemeScopeMatch(match[1], themeId));
}

/**
 * Upstream `setCustomColors`: the global entries, then every `[Theme]` block naming `themeId` on top, later
 * blocks winning. Values are hex or {@link DEFAULT_COLOR_CONFIG_VALUE}; anything else is dropped here and
 * reported by {@link colorCustomizationProblems}.
 */
export function colorCustomizationsForTheme(setting: unknown, themeId: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!isBlock(setting)) return result;
    const take = (block: Readonly<Record<string, unknown>>): void => {
        for (const [id, value] of Object.entries(block)) {
            if (!isThemeScope(id) && isColorValue(value)) result[id] = value;
        }
    };
    take(setting);
    for (const [key, block] of Object.entries(setting)) {
        if (isThemeScope(key) && isBlock(block) && scopeMatches(key, themeId)) take(block);
    }
    return result;
}

/** One message per skipped entry, in every block including those of inactive themes: a typo shows up at once. */
export function colorCustomizationProblems(setting: unknown): string[] {
    const problems: string[] = [];
    if (!isBlock(setting)) return problems;
    const check = (block: Readonly<Record<string, unknown>>, scope: string): void => {
        for (const [id, value] of Object.entries(block)) {
            if (scope === "" && isThemeScope(id)) {
                if (!isBlock(value)) {
                    problems.push(
                        `${COLOR_CUSTOMIZATIONS_SETTING}: "${id}" must be an object of colors for the themes it names`,
                    );
                } else {
                    check(value, `${id} `);
                }
            } else if (!isColorValue(value)) {
                problems.push(
                    `${COLOR_CUSTOMIZATIONS_SETTING}: ${scope}"${id}" must be a hex color (#RGB, #RGBA, #RRGGBB, ` +
                        `#RRGGBBAA) or "${DEFAULT_COLOR_CONFIG_VALUE}", got ${JSON.stringify(value)}; skipped`,
                );
            }
        }
    };
    check(setting, "");
    return problems;
}
