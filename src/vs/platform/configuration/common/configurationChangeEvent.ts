import type { ConfigurationModel } from "./configurationModel.ts";
import type { IConfigurationChangeEvent } from "./iConfigurationService.ts";

/** Includes language sections: a reader of a key with `overrideIdentifier` must learn about a section edit. */
export function diffConfigurationKeys(prev: ConfigurationModel, next: ConfigurationModel): string[] {
    const changed = new Set(diffTrees(prev, next));
    for (const identifier of diffOverrideIdentifiers(prev, next)) {
        for (const key of diffTrees(prev.getOverride(identifier), next.getOverride(identifier))) changed.add(key);
    }
    return [...changed];
}

export function diffOverrideIdentifiers(prev: ConfigurationModel, next: ConfigurationModel): string[] {
    const identifiers = new Set([...prev.getOverrideIdentifiers(), ...next.getOverrideIdentifiers()]);
    return [...identifiers].filter(
        (identifier) => diffTrees(prev.getOverride(identifier), next.getOverride(identifier)).length > 0,
    );
}

function diffTrees(prev: ConfigurationModel, next: ConfigurationModel): string[] {
    const keys = new Set<string>([...prev.collectKeys(), ...next.collectKeys()]);
    return [...keys].filter((key) => !valuesEqual(prev.get(key), next.get(key)));
}

/** Config is always JSON-compatible. */
function valuesEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** `affectsConfiguration(q)` holds for both an ancestor (`editor` ← `editor.tabSize`) and a descendant. */
export function createConfigurationChangeEvent(
    affectedKeys: readonly string[],
    overrideIdentifiers: readonly string[] = [],
): IConfigurationChangeEvent {
    return {
        affectedKeys,
        overrideIdentifiers,
        affectsConfiguration(key: string): boolean {
            return affectedKeys.some((k) => k === key || k.startsWith(`${key}.`) || key.startsWith(`${k}.`));
        },
    };
}
