import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

const GAP = "  ";

/** `available` бейджа не несёт. */
export type ExtensionRowBadge = "installed" | "update" | "incompatible" | "reload";

export const PARTIAL_SUPPORT_BADGE = "Partial";

export interface IExtensionRowLayout {
    readonly text: string;
    /** Пустой — версии нет. */
    readonly version: { readonly start: number; readonly length: number };
    /** Отдельно от {@link badge}: бейдж — про установку, пометка — про функциональность, видны обе. */
    readonly partialSupport: { readonly start: number; readonly length: number } | null;
    readonly badge: { readonly start: number; readonly length: number; readonly kind: ExtensionRowBadge } | null;
}

/** Выделение и hover рисует сам `ListViewElement`. */
export interface IExtensionRowStyles {
    /** Версия и бейдж «Installed». */
    readonly dimFg: StyleColor;
    /** Обновление — доступное действие, а не проблема. */
    readonly updateFg: StyleColor;
    readonly warningFg: StyleColor;
}

/** Версия — установленная, иначе последняя из реестра: куда обновляться, говорит бейдж. */
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

/** Бейдж — по версиям (как и статус страницы), кроме несовместимости: её знает только `availability`. */
function badgeTextOf(entry: IExtensionListEntry): { text: string; kind: ExtensionRowBadge } | null {
    // «Ждём перезагрузки» перебивает всё: состояние на диске и в работающем редакторе расходятся.
    if (entry.needsReload) return { text: "Reload", kind: "reload" };
    if (entry.availability === "incompatible") return { text: "Incompatible", kind: "incompatible" };
    if (entry.installedVersion === null) return null;
    if (entry.latestVersion !== null && entry.latestVersion !== entry.installedVersion) {
        return { text: `Update ${entry.latestVersion}`, kind: "update" };
    }
    return { text: "Installed", kind: "installed" };
}

export function buildExtensionRow(
    id: string,
    entry: IExtensionListEntry,
    styles: IExtensionRowStyles,
): TextLabelElement {
    const layout = describeExtensionRow(entry);
    const row = new TextLabelElement(layout.text);
    row.id = id;
    paintRow(row, layout, styles);
    return row;
}

const BADGE_COLOR: Record<ExtensionRowBadge, keyof IExtensionRowStyles> = {
    installed: "dimFg",
    update: "updateFg",
    incompatible: "warningFg",
    // Перезагрузка — такое же доступное действие, как обновление.
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

export function buildGroupRow(id: string, title: string, dimFg: StyleColor): TextLabelElement {
    const row = new TextLabelElement(title);
    row.id = id;
    row.setColors(dimFg, INHERITED_BG);
    return row;
}
