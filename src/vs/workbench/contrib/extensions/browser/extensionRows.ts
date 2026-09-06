import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

/**
 * Строки списка Extensions view: обычные `TextLabelElement` с посимвольной
 * подсветкой (приём `searchResultRows.ts`). Разметка строки чистая функция
 * {@link describeExtensionRow} — её же читают тесты, а не отрендеренный кадр.
 */

/** Отступ между смысловыми кусками строки. */
const GAP = "  ";

/** Бейдж состояния — правая часть строки; `available` бейджа не несёт. */
export type ExtensionRowBadge = "installed" | "update" | "incompatible" | "reload";

export interface IExtensionRowLayout {
    readonly text: string;
    /** Спан версии (приглушённый); пустой — версии нет. */
    readonly version: { readonly start: number; readonly length: number };
    /** Спан бейджа и его вид; `null` — бейджа нет. */
    readonly badge: { readonly start: number; readonly length: number; readonly kind: ExtensionRowBadge } | null;
}

/** Цвета кусков строки (выделение и hover рисует сам `ListViewElement`). */
export interface IExtensionRowStyles {
    /** Версия и бейдж «Installed». */
    readonly dimFg: StyleColor;
    /** Бейдж «Update …» — доступное действие, а не проблема. */
    readonly updateFg: StyleColor;
    /** Бейдж «Incompatible». */
    readonly warningFg: StyleColor;
}

/**
 * Раскладка строки: `<displayName>  <версия>  <бейдж>`. Показывается
 * УСТАНОВЛЕННАЯ версия, если расширение установлено, иначе последняя из
 * реестра: пользователю важнее, что у него стоит, а куда обновляться —
 * говорит бейдж.
 */
export function describeExtensionRow(entry: IExtensionListEntry): IExtensionRowLayout {
    // Версии может не быть вовсе — карточки без записи в реестре и без
    // установленной версии не бывает, но тип это допускает, и строка тогда
    // остаётся именем, а не «undefined».
    const version = entry.installedVersion ?? entry.latestVersion;
    const badgeText = badgeTextOf(entry);
    let text = entry.displayName;
    const versionStart = text.length + GAP.length;
    if (version !== null) text += `${GAP}${version}`;
    const badgeStart = text.length + GAP.length;
    if (badgeText !== null) text += `${GAP}${badgeText.text}`;
    return {
        text,
        version: { start: versionStart, length: version?.length ?? 0 },
        badge: badgeText === null ? null : { start: badgeStart, length: badgeText.text.length, kind: badgeText.kind },
    };
}

/** Бейдж — по версиям (как и статус страницы), кроме несовместимости: её знает только `availability`. */
function badgeTextOf(entry: IExtensionListEntry): { text: string; kind: ExtensionRowBadge } | null {
    // «Ждём перезагрузки» перебивает всё: пока окно не перезапущено, состояние
    // на диске и состояние работающего редактора расходятся, и это главное,
    // что нужно знать про такую запись.
    if (entry.needsReload) return { text: "Reload", kind: "reload" };
    if (entry.availability === "incompatible") return { text: "Incompatible", kind: "incompatible" };
    if (entry.installedVersion === null) return null;
    if (entry.latestVersion !== null && entry.latestVersion !== entry.installedVersion) {
        // Версия, до которой обновит кнопка, — в самом бейдже: иначе строка
        // говорит «есть обновление», не говоря, какое.
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

/** Какое поле стилей красит бейдж. Таблицей — вид бейджа это данные, не ветвление. */
const BADGE_COLOR: Record<ExtensionRowBadge, keyof IExtensionRowStyles> = {
    installed: "dimFg",
    update: "updateFg",
    incompatible: "warningFg",
    // Перезагрузка — такое же доступное действие, как обновление.
    reload: "updateFg",
};

/** Красит версию и бейдж; остальной текст остаётся цветом строки. */
function paintRow(row: TextLabelElement, layout: IExtensionRowLayout, styles: IExtensionRowStyles): void {
    paintSpan(row, layout.version.start, layout.version.length, styles.dimFg);
    if (layout.badge !== null) {
        paintSpan(row, layout.badge.start, layout.badge.length, styles[BADGE_COLOR[layout.badge.kind]]);
    }
}

function paintSpan(row: TextLabelElement, start: number, length: number, fg: StyleColor): void {
    for (let i = start; i < start + length; i++) {
        row.setCharStyle(i, { fg });
    }
}

/** Строка-заголовок группы («MARKETPLACE», «INSTALLED») — приглушённая, кликом сворачивается. */
export function buildGroupRow(id: string, title: string, dimFg: StyleColor): TextLabelElement {
    const row = new TextLabelElement(title);
    row.id = id;
    row.setColors(dimFg, INHERITED_BG);
    return row;
}
