import { DisplayLine } from "@tuidom/core/common/displayLine";
import { abbreviatePath, truncateEnd } from "@tuidom/core/common/textTruncation";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { CONTENT_PAD } from "./quickPickFrameElement.ts";

/**
 * Строки результатов quick pick для `ListViewElement` — по образцу
 * `contrib/search/browser/searchResultRows.ts` и `contrib/scm/browser/scmChangeRows.ts`:
 * ряд собран из `TextLabelElement`, посимвольная подсветка совпадений — через
 * `setCharStyle`, правое выравнивание — филлером `hflexFill()`.
 *
 * Раскладку считаем здесь, на известной ширине контента: у пикера ширина задана
 * `preferredWidth` до layout, поэтому бюджет лейбла и описания не приходится
 * пересчитывать в `performLayout` (мутация текста во время layout ставила бы
 * дерево грязным на каждом кадре).
 *
 * Приоритет — у лейбла: он показывается целиком, пока влезает, а описание
 * ужимается до остатка (`abbreviatePath`). Метаданные (бейдж/шорткат/подсказка)
 * короткие и показываются всегда целиком.
 */

/** Отступ между лейблом и описанием / между метаданными. */
const GAP = "  ";
/** Колонка иконки: сам глиф плюс пробел за ним. */
const ICON_WIDTH = 2;
/** Колонка чекбокса множественного выбора: сам чекбокс плюс пробел за ним. */
const CHECKBOX_WIDTH = 4;
/**
 * Чекбоксы рисуем скобками и галочкой `✓` (той же, что у отмеченных
 * пунктов меню), а не символами `☐`/`☑`: у тех ширина в терминале
 * неоднозначная (East Asian Ambiguous) и колонка разъезжалась бы.
 */
const CHECKED_BOX = "[✓] ";
const UNCHECKED_BOX = "[ ] ";

/**
 * Цвет, который на выделенной строке уступает место цвету выделения. Отдельным
 * when-вариантом, а не пересчётом при смене курсора: состояние `selected` ставит
 * на хост-строку сам `ListViewElement`, а `in:` видит его на предке.
 */
function dimmed(fg: string): { fg: string; when: readonly { states: readonly string[]; fg: string }[] } {
    return {
        fg,
        when: [{ states: ["in:selected"], fg: "list.activeSelectionForeground" }],
    };
}

export function rowId(index: number): string {
    return `quickPickItem-${String(index)}`;
}

/**
 * Колонки ряда, общие для всего списка: их наличие решается по списку целиком,
 * иначе лейблы разъезжались бы между строками.
 */
export interface IRowColumns {
    /** Колонка иконки включена (у кого-то в списке иконка есть). */
    readonly hasIcons: boolean;
    /**
     * Состояние чекбокса множественного выбора. `undefined` — колонки чекбоксов
     * в этом списке нет вовсе (одиночный выбор).
     */
    readonly checked?: boolean;
}

/**
 * Собирает ряд для предмета. `innerWidth` — ширина внутри рамки (фон выделения
 * тянется на неё целиком, поэтому отступы держат крайние филлеры ряда, а не
 * контейнер вокруг списка). Колонки — {@link IRowColumns}.
 */
export function buildItemRow(
    item: QuickPickItem,
    index: number,
    innerWidth: number,
    columns: IRowColumns,
): HFlexElement {
    const { hasIcons, checked } = columns;
    const row = new HFlexElement();
    row.id = rowId(index);
    // База без собственного фона — фон даёт рамка; выделение красит строку целиком.
    row.style = {
        when: [
            {
                states: ["in:selected"],
                fg: "list.activeSelectionForeground",
                bg: "list.activeSelectionBackground",
            },
        ],
    };

    const contentWidth = Math.max(0, innerWidth - CONTENT_PAD * 2);
    row.addChild(new FillerElement(), { width: hflexFixed(CONTENT_PAD), height: 1 });

    // Чекбокс — самая левая колонка: взгляд ищет отметки одним столбцом.
    const checkboxWidth = checked !== undefined ? CHECKBOX_WIDTH : 0;
    if (checked !== undefined) {
        const box = new TextLabelElement(checked ? CHECKED_BOX : UNCHECKED_BOX);
        row.addChild(box, { width: hflexFixed(CHECKBOX_WIDTH), height: 1 });
    }

    const iconWidth = hasIcons ? ICON_WIDTH : 0;
    if (hasIcons) {
        const icon = new TextLabelElement(item.icon ?? " ");
        row.addChild(icon, { width: hflexFixed(ICON_WIDTH), height: 1 });
    }

    const avail = Math.max(0, contentWidth - iconWidth - checkboxWidth);

    const before: TextLabelElement[] = [];
    const after: TextLabelElement[] = [];
    if (item.badge !== undefined) {
        before.push(styled(` ★ ${item.badge}`, "quickPick.badgeForeground"));
    }
    if (item.shortcut !== undefined) {
        after.push(styled(`${GAP}${item.shortcut}`, "quickPick.shortcutForeground"));
    }
    if (item.hint !== undefined) {
        after.push(styled(`${GAP}${item.hint}`, "quickPick.hintForeground"));
    }
    const metaWidth = [...before, ...after].reduce((sum, part) => sum + textWidth(part), 0);

    // Место, которое делят лейбл и описание, после фиксированных метаданных.
    const shared = Math.max(0, avail - metaWidth);
    const labelNatural = new DisplayLine(item.label).displayWidth;
    const labelFits = labelNatural <= shared;
    const labelText = labelFits ? item.label : truncateEnd(item.label, shared);

    const label = new TextLabelElement(labelText);
    applyMatchHighlight(label, labelText, item.labelMatchRanges ?? []);
    row.addChild(label, { width: hflexFixed(new DisplayLine(labelText).displayWidth), height: 1 });

    // Филлер съедает остаток — правые части прижимаются к правому краю контента.
    row.addChild(new FillerElement(), { width: hflexFill(), height: 1 });

    const description = buildDescription(item, labelFits ? shared - labelNatural : 0);

    for (const part of [...before, ...(description ? [description] : []), ...after]) {
        row.addChild(part, { width: hflexFixed(textWidth(part)), height: 1 });
    }

    row.addChild(new FillerElement(), { width: hflexFixed(CONTENT_PAD), height: 1 });

    return row;
}

/** Описание (путь/категория) в остаток места, при нехватке — сокращённое. */
function buildDescription(item: QuickPickItem, budget: number): TextLabelElement | null {
    const text = item.description;
    if (text === undefined || text === "") return null;
    const dirBudget = budget - GAP.length;
    if (dirBudget < 1) return null;
    const shown = new DisplayLine(text).displayWidth <= dirBudget ? text : abbreviatePath(text, dirBudget);
    return styled(`${GAP}${shown}`, "descriptionForeground");
}

function styled(text: string, fg: string): TextLabelElement {
    const label = new TextLabelElement(text);
    label.style = dimmed(fg);
    return label;
}

function textWidth(label: TextLabelElement): number {
    return new DisplayLine(label.getText()).displayWidth;
}

/**
 * Красит найденные fuzzy-совпадения. Диапазоны приходят в code-unit-оффсетах
 * исходного лейбла — за обрез усечённого текста не заходим.
 */
function applyMatchHighlight(label: TextLabelElement, text: string, ranges: readonly [number, number][]): void {
    for (const [start, end] of ranges) {
        for (let i = start; i < Math.min(end, text.length); i++) {
            label.setCharStyle(i, { fg: "list.highlightForeground" });
        }
    }
}
