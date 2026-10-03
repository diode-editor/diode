import type { ConfigurationModel } from "./configurationModel.ts";
import type { IConfigurationChangeEvent } from "./iConfigurationService.ts";

/**
 * Множество точечных ключей, значение которых различается между двумя
 * моделями. Используется для `affectedKeys` события изменения. Значения
 * сравниваются структурно (config всегда JSON-совместим).
 */
export function diffConfigurationKeys(prev: ConfigurationModel, next: ConfigurationModel): string[] {
    const keys = new Set<string>([...prev.collectKeys(), ...next.collectKeys()]);
    const changed: string[] = [];
    for (const key of keys) {
        if (!valuesEqual(prev.get(key), next.get(key))) changed.push(key);
    }
    return changed;
}

function valuesEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Собирает {@link IConfigurationChangeEvent} из списка изменившихся ключей.
 * `affectsConfiguration(q)` — true, если `q` совпадает с затронутым ключом,
 * является его предком (`editor` ← `editor.tabSize`) или потомком.
 */
export function createConfigurationChangeEvent(affectedKeys: readonly string[]): IConfigurationChangeEvent {
    return {
        affectedKeys,
        affectsConfiguration(key: string): boolean {
            return affectedKeys.some((k) => k === key || k.startsWith(`${key}.`) || key.startsWith(`${k}.`));
        },
    };
}
