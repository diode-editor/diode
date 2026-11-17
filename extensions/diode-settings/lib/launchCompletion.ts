import { findNodeAtLocation, getLocation, getNodeValue, type Node, parseTree, type Segment } from "jsonc-parser";

import {
    type AttributeMap,
    collectDebuggers,
    configurationAttributes,
    configurationSnippets,
    type IAttributeSchema,
    LAUNCH_ROOT_ATTRIBUTES,
} from "./launchSchema.ts";
import { type IOffsetRange, tokenRangeAt } from "./settingsContext.ts";
import { completionValuesFor } from "./settingValues.ts";

export interface ILaunchCompletion {
    readonly label: string;
    readonly kind: "property" | "value" | "snippet";
    /** A plain JSON text, or snippet syntax for `kind: "snippet"`. */
    readonly insertText: string;
    readonly detail?: string;
    readonly documentation?: string;
    readonly replaceRange: IOffsetRange;
}

/**
 * Where the launch object lives in a file: the root of `launch.json`, `launch` of `settings.json`,
 * `launch` or `settings.launch` of a `.code-workspace` file.
 */
export type LaunchRoot = readonly string[];

/**
 * Completion of launch configurations, as the JSON language service gives it by upstream's `launch`
 * schema: the top-level keys, the attributes of a configuration by its `type` and `request` with their
 * enum/boolean/default values, and the debuggers' snippets in place of a configuration. `packageJSONs` —
 * the manifests of all extensions, the source of `contributes.debuggers`.
 */
export function provideLaunchCompletions(
    text: string,
    offset: number,
    roots: readonly LaunchRoot[],
    packageJSONs: readonly unknown[],
    indentUnit = "\t",
): ILaunchCompletion[] {
    const location = getLocation(text, offset);
    const root = roots.find((r) => r.every((segment, i) => location.path[i] === segment));
    if (root === undefined) return [];
    const path = location.path.slice(root.length);
    const replaceRange = tokenRangeAt(text, offset);
    // Undefined only for an empty document, which has no path to complete.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tree = parseTree(text)!;

    if (path.length === 1) {
        if (location.isAtPropertyKey) {
            return keyItems(LAUNCH_ROOT_ATTRIBUTES, existingKeys(tree, [...root], path[0]), replaceRange);
        }
        return valueItems(LAUNCH_ROOT_ATTRIBUTES[path[0]], replaceRange);
    }
    if (path[0] !== "configurations" || typeof path[1] !== "number") return [];

    const debuggers = collectDebuggers(packageJSONs);
    if (path.length === 2) {
        const separator = separatorAfter(text, replaceRange.end);
        const line = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);
        const lineIndent = line.slice(0, line.length - line.trimStart().length);
        return configurationSnippets(debuggers).map((snippet) => ({
            label: snippet.label,
            kind: "snippet",
            insertText: adjustWhitespace(snippetText(snippet.body), lineIndent, indentUnit) + separator,
            documentation: snippet.description,
            replaceRange,
        }));
    }
    if (path.length !== 3) return [];

    const configurationPath = [...root, ...path.slice(0, 2)];
    const valueAt = (name: string): unknown => findNodeAtLocation(tree, [...configurationPath, name])?.value;
    const attributes = configurationAttributes(debuggers, valueAt("type"), valueAt("request"));
    if (location.isAtPropertyKey) {
        return keyItems(attributes, existingKeys(tree, configurationPath, path[2]), replaceRange);
    }
    return valueItems(attributes[path[2]], replaceRange);
}

/**
 * The keys of the object, except the one being typed: upstream doesn't suggest a key twice. The object
 * exists: the caret is at one of its keys.
 */
function existingKeys(tree: Node, objectPath: Segment[], typed: Segment): Set<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const keys = new Set<unknown>(Object.keys(getNodeValue(findNodeAtLocation(tree, objectPath)!) as object));
    keys.delete(typed);
    return keys;
}

function describe(schema: IAttributeSchema): string | undefined {
    return schema.description ?? schema.markdownDescription;
}

function keyItems(attributes: AttributeMap, existing: Set<unknown>, replaceRange: IOffsetRange): ILaunchCompletion[] {
    return Object.entries(attributes)
        .filter(([key, schema]) => !existing.has(key) && schema.doNotSuggest !== true)
        .map(([key, schema]) => ({
            label: key,
            kind: "property",
            insertText: JSON.stringify(key),
            detail: typeof schema.type === "string" ? schema.type : schema.type?.join(" | "),
            documentation: describe(schema),
            replaceRange,
        }));
}

function valueItems(schema: IAttributeSchema | undefined, replaceRange: IOffsetRange): ILaunchCompletion[] {
    if (schema === undefined) return [];
    const defaultLiteral = JSON.stringify(schema.default);
    // The values keep the enum's order: its descriptions go by index.
    return completionValuesFor(schema).map((literal, i) => ({
        label: literal,
        kind: "value",
        insertText: literal,
        detail: literal === defaultLiteral ? "default" : undefined,
        documentation: schema.enumDescriptions?.[i] ?? describe(schema),
        replaceRange,
    }));
}

/** The JSON language service's `evaluateSeparatorAfter`: a comma before the next configuration. */
function separatorAfter(text: string, offset: number): string {
    const next = /\S/.exec(text.slice(offset))?.[0];
    return next === "{" || next === '"' || next === "[" ? "," : "";
}

/**
 * Upstream `SnippetSession.adjustWhitespace`: the lines after the first one start at the indentation
 * of the caret's line, and the template's tabs become the editor's indentation unit. Temporary: the core
 * accepts a completion's snippet as plain text, without a snippet session (#1035); with one it adjusts the
 * whitespace itself, and this goes away.
 */
function adjustWhitespace(template: string, lineIndent: string, indentUnit: string): string {
    return template.replace(/\n(\t*)/g, (_, tabs: string) => `\n${lineIndent}${indentUnit.repeat(tabs.length)}`);
}

/**
 * The JSON language service's `getInsertTextForSnippetValue`: the body pretty-printed with tabs; a
 * string starting with `^` goes in raw (the way a snippet inserts a number or a `${…}` placeholder
 * without quotes), the rest as JSON strings whose `${…}` stay placeholders.
 */
export function snippetText(body: unknown, indent = ""): string {
    if (typeof body === "string" && body.startsWith("^")) return body.slice(1);
    if (typeof body !== "object" || body === null) return JSON.stringify(body);
    const inner = `${indent}\t`;
    const entries = Array.isArray(body)
        ? body.map((item) => inner + snippetText(item, inner))
        : Object.entries(body).map(([key, value]) => `${inner}${JSON.stringify(key)}: ${snippetText(value, inner)}`);
    const [open, close] = Array.isArray(body) ? ["[", "]"] : ["{", "}"];
    return entries.length === 0 ? open + close : `${open}\n${entries.join(",\n")}\n${indent}${close}`;
}
