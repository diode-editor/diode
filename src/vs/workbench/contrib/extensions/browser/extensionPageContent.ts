import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_FG } from "@tuidom/core/dom/styles/tuiStyle";

import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

// We wrap words ourselves: tuidom has no wrapping element (`TextBlockElement` is a block of fixed lines).

export type ExtensionPageTone = "normal" | "dim" | "warning";

export interface IExtensionPageLine {
    readonly text: string;
    readonly tone: ExtensionPageTone;
}

export const TONE_COLORS: Record<ExtensionPageTone, StyleColor> = {
    normal: INHERITED_FG,
    dim: "descriptionForeground",
    warning: "editorWarning.foreground",
};

export interface IExtensionPageContent {
    readonly entry: IExtensionListEntry;
    /** Registry metadata; `undefined` means no entry (the extension was installed outside the marketplace). */
    readonly meta: IRegistryExtensionMeta | undefined;
    /** Why metadata is missing (network failure); `null` means the registry answered. */
    readonly metaError: string | null;
    readonly operationError: string | null;
}

const MIN_WRAP_WIDTH = 8;

/** Empty lines are kept (paragraph separator); a word longer than the width is hard-split. */
export function wrapText(text: string, width: number): string[] {
    const limit = Math.max(MIN_WRAP_WIDTH, width);
    const out: string[] = [];
    for (const paragraph of text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(" ")) {
            for (const piece of splitLongWord(word, limit)) {
                if (line.length === 0) {
                    line = piece;
                } else if (line.length + 1 + piece.length <= limit) {
                    line += ` ${piece}`;
                } else {
                    out.push(line);
                    line = piece;
                }
            }
        }
        // Always flush the tail: for a whitespace-only paragraph it is empty, which is the paragraph's blank line.
        out.push(line);
    }
    return out;
}

/**
 * Chunk count is computed upfront, not with a "while too long" loop: mutants made that loop spin forever,
 * hanging the runner.
 */
function splitLongWord(word: string, limit: number): string[] {
    const chunks = Math.ceil(word.length / limit);
    return Array.from({ length: chunks }, (_, i) => word.slice(i * limit, (i + 1) * limit));
}

/** "Update available" is by `availability`: the target is newer by semver, not just different (US-2.3). */
export function statusLine(entry: IExtensionListEntry): string {
    if (entry.availability === "incompatible") return "Incompatible with this build of Diode";
    if (entry.installedVersion === null) return "Not installed";
    if (entry.availability === "outdated") {
        return `Installed ${entry.installedVersion} · update available: ${String(entry.latestVersion)}`;
    }
    return `Installed ${entry.installedVersion}`;
}

/** The demo scenario looks for this text; it is part of the page contract. */
export const PARTIAL_SUPPORT_HEADLINE = "Partial support: some features do not work in Diode";

const WORKS_TITLE = "Works in Diode:";
const LIMITS_TITLE = "Does not work:";

/** From the entry, not the metadata: the flag comes with the index, so the block shows even without metadata. */
export function buildSupportLines(content: IExtensionPageContent, width: number): IExtensionPageLine[] {
    const support = content.entry.support;
    const { lines, push, wrapped } = lineWriter(width);
    if (support?.level !== "partial") return lines;

    // Don't repeat the headline: it is already in the pinned header, and the body below it
    // scrolls, so a duplicate would read as a second, different message.
    for (const [title, items, tone] of [
        [WORKS_TITLE, support.works, "dim"],
        [LIMITS_TITLE, support.limits, "warning"],
    ] as const) {
        if (items === undefined || items.length === 0) continue;
        push(title, "dim");
        // Marker without leading spaces: `wrapText` splits on spaces, so the indent would be lost anyway.
        for (const item of items) wrapped(`- ${item}`, tone);
    }
    push("");
    return lines;
}

function requirementsOf(meta: IRegistryExtensionMeta | undefined, version: string | null): string {
    const engines = meta?.versions.find((v) => v.version === version)?.engines;
    const parts: string[] = [];
    if (engines?.diode !== undefined) parts.push(`diode ${engines.diode}`);
    if (engines?.vscode !== undefined) parts.push(`vscode ${engines.vscode}`);
    return parts.join(", ");
}

function lineWriter(width: number): {
    lines: IExtensionPageLine[];
    push: (text: string, tone?: ExtensionPageTone) => void;
    wrapped: (text: string, tone?: ExtensionPageTone) => void;
} {
    const lines: IExtensionPageLine[] = [];
    const push = (text: string, tone: ExtensionPageTone = "normal"): void => {
        lines.push({ text, tone });
    };
    const wrapped = (text: string, tone: ExtensionPageTone = "normal"): void => {
        for (const line of wrapText(text, width)) push(line, tone);
    };
    return { lines, push, wrapped };
}

/** Pinned above the readme, so it ends with a blank spacer line before the button row. */
export function buildExtensionHeaderLines(content: IExtensionPageContent, width: number): IExtensionPageLine[] {
    const { entry, meta, operationError } = content;
    const { lines, push, wrapped } = lineWriter(width);

    wrapped(entry.displayName);
    push(entry.id, "dim");
    if (entry.description.length > 0) wrapped(entry.description);
    push("");

    push(statusLine(entry), entry.availability === "incompatible" ? "warning" : "dim");
    const version = entry.latestVersion ?? entry.installedVersion;
    if (entry.latestVersion !== null) push(`Latest version: ${entry.latestVersion}`, "dim");
    const requirements = requirementsOf(meta, version);
    if (requirements.length > 0) push(`Requires: ${requirements}`, "dim");
    if (entry.kind !== undefined) push(`Kind: ${entry.kind}`, "dim");
    if (entry.support?.level === "partial") push(PARTIAL_SUPPORT_HEADLINE, "warning");
    if (meta?.license !== undefined) push(`License: ${meta.license}`, "dim");
    if (meta?.repository !== undefined) wrapped(`Repository: ${meta.repository}`, "dim");
    if (meta?.homepage !== undefined) wrapped(`Homepage: ${meta.homepage}`, "dim");
    if (operationError !== null) wrapped(operationError, "warning");
    push("");
    return lines;
}

/** Readme as is: the project has no markdown renderer. */
export function buildExtensionBodyLines(content: IExtensionPageContent, width: number): IExtensionPageLine[] {
    const { meta, metaError } = content;
    const { lines, wrapped } = lineWriter(width);
    // Limitations come before the readme and before the "no metadata" branches: the flag arrives with the index.
    lines.push(...buildSupportLines(content, width));

    if (metaError !== null) {
        wrapped(`Cannot read this extension from the registry: ${metaError}`, "warning");
        return lines;
    }
    if (meta === undefined) {
        wrapped("This extension is not in the marketplace — it was installed from a file.", "dim");
        return lines;
    }
    if (meta.readme === undefined) {
        wrapped("No readme published for this extension.", "dim");
        return lines;
    }
    wrapped(meta.readme);
    return lines;
}
