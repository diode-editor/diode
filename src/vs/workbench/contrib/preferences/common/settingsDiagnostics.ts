import { parseTree } from "jsonc-parser";

import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ConfigurationScope } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type { IMarkerData } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";

/**
 * Почему ключ не действует в settings.json воркспейса — тексты эталона
 * (`generateUnsupportedApplicationSettingMarker` /
 * `generateUnsupportedMachineSettingMarker`, `preferencesRenderers.ts`);
 * `null` — ключ в воркспейсе действует (или он вне реестра).
 */
export function workspaceUnsupportedSettingMessage(scope: ConfigurationScope | undefined): string | null {
    if (scope === "application") {
        return "This setting has an application scope and can only be set in the settings file from the Default profile.";
    }
    if (scope === "machine") {
        return "This setting can only be applied in user settings in local window or in remote settings in remote window.";
    }
    return null;
}

/**
 * Validates a `settings.json` document against the set of known configuration
 * keys and returns a diagnostic marker for every unknown top-level property —
 * the terminal analogue of VS Code's JSON-schema validation of settings.json,
 * minus the JSON language server. Unknown settings surface as *warnings*
 * ("Unknown Configuration Setting"), matching VS Code.
 *
 * Pure and provider-agnostic: the caller supplies the `isKnownKey` predicate
 * (built from the app + extension configuration defaults), so this stays
 * decoupled from the Configuration layer and is trivially testable.
 *
 * `unsupportedMessage` — второй вопрос к известному ключу: может ли он
 * действовать В ЭТОМ файле. Для settings.json воркспейса это ключи со `scope`
 * `application`/`machine`: файл их не применяет, и эталон
 * (`handleWorkspaceConfiguration` в `preferencesRenderers.ts`) ставит на них
 * подсказку (`Hint`) с объяснением. `null` — ключ здесь действует.
 */
export function validateSettingsJson(
    text: string,
    isKnownKey: (key: string) => boolean,
    unsupportedMessage: (key: string) => string | null = () => null,
): IMarkerData[] {
    const root = parseTree(text);
    if (root?.type !== "object") return [];

    const lineStarts = computeLineStarts(text);
    const markers: IMarkerData[] = [];
    // parseTree guarantees an object node carries a `children` array and each of
    // its property children carries a string key node at index 0 (malformed keys
    // never produce a property), so no runtime guards are needed here.
    /* v8 ignore start -- defensive: parseTree guarantees an object node carries a `children` array */
    for (const property of root.children ?? []) {
        /* v8 ignore stop */
        const keyNode = property.children?.[0];
        /* v8 ignore start -- defensive: each property child carries a string key node at index 0 */
        if (keyNode === undefined) continue;
        /* v8 ignore stop */
        const key = keyNode.value as string;
        const start = offsetToPosition(lineStarts, keyNode.offset);
        const end = offsetToPosition(lineStarts, keyNode.offset + keyNode.length);
        if (isKnownKey(key)) {
            const message = unsupportedMessage(key);
            if (message !== null) {
                markers.push({
                    severity: MarkerSeverity.Hint,
                    range: createRange(start.line, start.character, end.line, end.character),
                    message,
                    code: "unsupportedSetting",
                    source: "json",
                });
            }
            continue;
        }

        markers.push({
            severity: MarkerSeverity.Warning,
            range: createRange(start.line, start.character, end.line, end.character),
            message: `Unknown Configuration Setting: ${key}`,
            code: "unknownSetting",
            source: "json",
        });
    }
    return markers;
}

/**
 * Flattens a nested configuration-defaults tree into the set of every valid
 * dotted key AND every dotted prefix, so both flat keys (`"editor.tabSize"`)
 * and object-valued parents (`"editor": { … }`) count as known.
 */
export function collectKnownSettingKeys(tree: Readonly<Record<string, unknown>>): Set<string> {
    const keys = new Set<string>();
    const walk = (node: Readonly<Record<string, unknown>>, prefix: string): void => {
        for (const [k, value] of Object.entries(node)) {
            const dotted = prefix === "" ? k : `${prefix}.${k}`;
            keys.add(dotted);
            if (isPlainObject(value)) walk(value, dotted);
        }
    };
    walk(tree, "");
    return keys;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Offsets at which each line begins (`lineStarts[0]` is always 0). */
function computeLineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
    }
    return starts;
}

/** Converts a character offset to a 0-based `{ line, character }` position. */
function offsetToPosition(lineStarts: number[], offset: number): { line: number; character: number } {
    // Largest line whose start is <= offset.
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (lineStarts[mid] <= offset) low = mid;
        else high = mid - 1;
    }
    return { line: low, character: offset - lineStarts[low] };
}
