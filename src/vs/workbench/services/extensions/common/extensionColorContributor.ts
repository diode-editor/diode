import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import {
    type ColorContribution,
    deriveDefaultColors,
    type IColorDefaults,
    type IColorDefinition,
    isColorReference,
    type ThemeKind,
} from "../../../../platform/theme/common/colorRegistry.ts";
import {
    COLOR_CONTRIBUTIONS,
    defaultWorkbenchColors,
} from "../../../../platform/theme/common/colors/colorContributions.ts";
import { isHexColor } from "../../../../platform/theme/common/colorUtils.ts";
import { followReference } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { ThemeRegistry } from "../../themes/common/themeRegistry.ts";

/** Upstream `colorIdPattern` (colorExtensionPoint.ts). */
const COLOR_ID_PATTERN = /^\w+[.\w+]*$/;

const THEME_KINDS: readonly ThemeKind[] = ["dark", "light"];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Upstream validation, error texts verbatim; the first invalid entry stops the rest of this extension's
 * entries (upstream stops the whole handler). `highContrast`/`highContrastLight` are validated and
 * dropped: the registry has two slots, hc takes `dark` and hcLight takes `light`.
 */
function validateEntry(
    entry: unknown,
    error: (message: string) => void,
): entry is {
    id: string;
    description: string;
    defaults: { dark: string; light: string };
} {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
        error("'configuration.colors.id' must be defined and can not be empty");
        return false;
    }
    if (!COLOR_ID_PATTERN.test(entry.id)) {
        error("'configuration.colors.id' must only contain letters, digits and dots and can not start with a dot");
        return false;
    }
    if (typeof entry.description !== "string") {
        error("'configuration.colors.description' must be defined and can not be empty");
        return false;
    }
    const defaults = entry.defaults;
    if (!isRecord(defaults) || typeof defaults.light !== "string" || typeof defaults.dark !== "string") {
        error("'configuration.colors.defaults' must be defined and must contain 'light' and 'dark'");
        return false;
    }
    for (const slot of ["highContrast", "highContrastLight"]) {
        const value = defaults[slot];
        if (value !== undefined && typeof value !== "string") {
            error(`If defined, 'configuration.colors.defaults.${slot}' must be a string.`);
            return false;
        }
    }
    return true;
}

/** A hex color or a reference; upstream substitutes red for an empty or broken value, we skip the entry. */
function isColorValue(value: string): boolean {
    return isColorReference(value) ? value.length > 0 : isHexColor(value);
}

/**
 * Counterpart of upstream `ColorExtensionPoint`: registers `contributes.colors` in the theme registry
 * before the first `resolve`. A built-in id stays built-in; between extensions the first one in load
 * order wins. A reference that doesn't resolve (unknown id, cycle) is a warning, the color stays unset.
 */
export function registerExtensionColors(
    extensions: readonly IExtension[],
    registry: ThemeRegistry,
    logger?: ILogger,
): void {
    const owners = new Map<string, string>();
    const contributed: Record<string, IColorDefinition> = {};
    for (const ext of extensions) {
        const colors = ext.manifest.contributes?.colors;
        if (colors === undefined) continue;
        const error = (message: string): void => {
            logger?.error(`${ext.id}: ${message}`);
        };
        if (!Array.isArray(colors)) {
            error("'configuration.colors' must be a array");
            continue;
        }
        for (const entry of colors as unknown[]) {
            if (!validateEntry(entry, error)) break;
            const { id, description, defaults } = entry;
            const invalid = THEME_KINDS.find((kind) => !isColorValue(defaults[kind]));
            if (invalid !== undefined) {
                error(
                    `configuration.colors.defaults.${invalid} must be either a color value in hex (#RRGGBB[AA] or #RGB[A]) or the identifier of a themable color which provides the default.`,
                );
                continue;
            }
            if (Object.hasOwn(COLOR_CONTRIBUTIONS, id)) {
                logger?.warn(`${ext.id}: color "${id}" is a built-in color — the contribution is ignored`);
                continue;
            }
            const owner = owners.get(id);
            if (owner !== undefined) {
                logger?.warn(
                    `${ext.id}: color "${id}" is already contributed by ${owner} — the contribution is ignored`,
                );
                continue;
            }
            const colorDefaults: IColorDefaults = { dark: defaults.dark, light: defaults.light };
            owners.set(id, ext.id);
            contributed[id] = { defaults: colorDefaults, description };
            registry.registerColor(id, colorDefaults, description);
        }
    }
    warnBrokenReferences(contributed, owners, logger);
}

/** Checked once against the registry defaults, not on every theme `resolve`. */
function warnBrokenReferences(
    contributed: ColorContribution,
    owners: ReadonlyMap<string, string>,
    logger?: ILogger,
): void {
    const reported = new Set<string>();
    for (const kind of THEME_KINDS) {
        const table = { ...deriveDefaultColors(contributed, kind), ...defaultWorkbenchColors(kind) };
        for (const [id, owner] of owners) {
            const resolved = followReference(table, id);
            if (!("problem" in resolved)) continue;
            const message = `${owner}: color "${id}" is left unset — ${resolved.problem}`;
            if (!reported.has(message)) logger?.warn(message);
            reported.add(message);
        }
    }
}
