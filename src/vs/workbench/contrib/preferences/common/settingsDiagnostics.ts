import { findNodeAtLocation, parseTree } from "jsonc-parser";

import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ConfigurationScope } from "../../../../platform/configuration/common/configurationRegistry.ts";
import type { IMarkerData } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";

/**
 * Upstream texts (`generateUnsupported{Application,Machine}SettingMarker`, `preferencesRenderers.ts`);
 * `null` — the key takes effect in the workspace.
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
 * Like upstream `handleWorkspaceFolderConfiguration`: `window` is added to the workspace reasons — the window
 * takes such keys from the workspace file.
 */
export function folderUnsupportedSettingMessage(scope: ConfigurationScope | undefined): string | null {
    if (scope === "window") {
        return "This setting cannot be applied in this workspace. It will be applied when you open the containing workspace folder directly.";
    }
    return workspaceUnsupportedSettingMessage(scope);
}

/**
 * Counterpart of VS Code's JSON schema validation of settings.json without a language server: an unknown key is a warning.
 * `unsupportedMessage` — whether a known key takes effect IN THIS file (upstream `handleWorkspaceConfiguration`
 * puts a `Hint` on it). `section` — the settings block (`settings` in `.code-workspace`).
 */
export function validateSettingsJson(
    text: string,
    isKnownKey: (key: string) => boolean,
    unsupportedMessage: (key: string) => string | null = () => null,
    section?: string,
): IMarkerData[] {
    const tree = parseTree(text);
    // Stryker disable next-line ConditionalExpression: findNodeAtLocation itself returns undefined for an empty tree — `tree === undefined` is needed only for its type
    const root = section === undefined || tree === undefined ? tree : findNodeAtLocation(tree, [section]);
    if (root?.type !== "object") return [];

    const lineStarts = computeLineStarts(text);
    const markers: IMarkerData[] = [];
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

/** Known are flat keys and every dotted prefix, so `"editor": { … }` counts too. */
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
