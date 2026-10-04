import type { ConfigurationModel } from "./configurationModel.ts";
import type { IConfigurationChangeEvent } from "./iConfigurationService.ts";

/**
 * Множество точечных ключей, значение которых различается между двумя
 * моделями — в основном дереве или в секции любого языка (`"[go]"`).
 * Используется для `affectedKeys` события изменения: потребитель, который читает
 * ключ с `overrideIdentifier`, обязан узнать и о правке секции языка. Значения
 * сравниваются структурно (config всегда JSON-совместим).
 */
export function diffConfigurationKeys(prev: ConfigurationModel, next: ConfigurationModel): string[] {
    const changed = new Set(diffTrees(prev, next));
    for (const identifier of diffOverrideIdentifiers(prev, next)) {
        for (const key of diffTrees(prev.getOverride(identifier), next.getOverride(identifier))) changed.add(key);
    }
    return [...changed];
}

/** Языки, секция которых различается между двумя моделями. */
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

function valuesEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Собирает {@link IConfigurationChangeEvent} из списка изменившихся ключей.
 * `affectsConfiguration(q)` — true, если `q` совпадает с затронутым ключом,
 * является его предком (`editor` ← `editor.tabSize`) или потомком.
 */
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
