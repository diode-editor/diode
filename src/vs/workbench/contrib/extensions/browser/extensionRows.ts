import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

const GAP = "  ";

/** Name with version and badges, the description, the publisher: upstream's list entry without the icon. */
export const EXTENSION_ROW_HEIGHT = 3;

/** `available` carries no badge. */
export type ExtensionRowBadge = "installed" | "update" | "incompatible" | "reload";

export const PARTIAL_SUPPORT_BADGE = "Partial";

export interface IExtensionRowLayout {
    readonly text: string;
    /** Empty means there is no version. */
    readonly version: { readonly start: number; readonly length: number };
    /** Separate from {@link badge}: the badge is about installation, the mark about functionality; both are visible. */
    readonly partialSupport: { readonly start: number; readonly length: number } | null;
    readonly badge: { readonly start: number; readonly length: number; readonly kind: ExtensionRowBadge } | null;
}

/** `ListViewElement` draws selection and hover itself. */
export interface IExtensionRowStyles {
    /** Version and the "Installed" badge. */
    readonly dimFg: StyleColor;
    /** An update is an available action, not a problem. */
    readonly updateFg: StyleColor;
    readonly warningFg: StyleColor;
}

/** Version is the installed one, otherwise the latest from the registry: the badge says what to update to. */
export function describeExtensionRow(entry: IExtensionListEntry): IExtensionRowLayout {
    const version = entry.installedVersion ?? entry.latestVersion;
    const badgeText = badgeTextOf(entry);
    const partial = entry.support?.level === "partial";
    let text = entry.displayName;
    const versionStart = text.length + GAP.length;
    if (version !== null) text += `${GAP}${version}`;
    const partialStart = text.length + GAP.length;
    if (partial) text += `${GAP}${PARTIAL_SUPPORT_BADGE}`;
    const badgeStart = text.length + GAP.length;
    if (badgeText !== null) text += `${GAP}${badgeText.text}`;
    return {
        text,
        version: { start: versionStart, length: version?.length ?? 0 },
        partialSupport: partial ? { start: partialStart, length: PARTIAL_SUPPORT_BADGE.length } : null,
        badge: badgeText === null ? null : { start: badgeStart, length: badgeText.text.length, kind: badgeText.kind },
    };
}

/** By `availability`: only it knows incompatibility and that the target is newer by semver (US-2.3). */
function badgeTextOf(entry: IExtensionListEntry): { text: string; kind: ExtensionRowBadge } | null {
    // "Waiting for reload" overrides everything: the state on disk and in the running editor differ.
    if (entry.needsReload) return { text: "Reload", kind: "reload" };
    if (entry.availability === "incompatible") return { text: "Incompatible", kind: "incompatible" };
    if (entry.installedVersion === null) return null;
    if (entry.availability === "outdated") {
        return { text: `Update ${String(entry.latestVersion)}`, kind: "update" };
    }
    return { text: "Installed", kind: "installed" };
}

/** The id of a row's first line (name, version, badges). */
export function extensionRowTitleId(rowId: string): string {
    return `${rowId}--title`;
}

/** {@link EXTENSION_ROW_HEIGHT} lines with a one-column gutter on both sides; the list appends it with that height. */
export function buildExtensionRow(id: string, entry: IExtensionListEntry, styles: IExtensionRowStyles): TUIElement {
    const layout = describeExtensionRow(entry);
    const header = new TextLabelElement(layout.text);
    // e2e and the inspector read the name line by it: the row is a container without text of its own.
    header.id = extensionRowTitleId(id);
    paintRow(header, layout, styles);
    const description = new TextLabelElement(entry.description);
    const publisher = new TextLabelElement(entry.publisher);
    publisher.setColors(styles.dimFg, INHERITED_BG);

    const lines = new VStackElement();
    for (const line of [header, description, publisher]) lines.addChild(line, { width: "fill", height: 1 });
    const row = new PaddingContainerElement(lines, { left: 1, right: 1 });
    row.id = id;
    return row;
}

const BADGE_COLOR: Record<ExtensionRowBadge, keyof IExtensionRowStyles> = {
    installed: "dimFg",
    update: "updateFg",
    incompatible: "warningFg",
    // Reload is an available action, just like an update.
    reload: "updateFg",
};

function paintRow(row: TextLabelElement, layout: IExtensionRowLayout, styles: IExtensionRowStyles): void {
    paintSpan(row, layout.version.start, layout.version.length, styles.dimFg);
    if (layout.partialSupport !== null) {
        paintSpan(row, layout.partialSupport.start, layout.partialSupport.length, styles.warningFg);
    }
    if (layout.badge !== null) {
        paintSpan(row, layout.badge.start, layout.badge.length, styles[BADGE_COLOR[layout.badge.kind]]);
    }
}

function paintSpan(row: TextLabelElement, start: number, length: number, fg: StyleColor): void {
    for (let i = start; i < start + length; i++) {
        row.setCharStyle(i, { fg });
    }
}
