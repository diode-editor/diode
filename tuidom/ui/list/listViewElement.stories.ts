import type { StoryContext, StoryMeta } from "../../../src/StoryRunner/StoryTypes.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { ScrollBarDecorator } from "../scrollbar/scrollContainerElement.ts";
import { TextLabelElement } from "../text/textLabelElement.ts";

import { ListViewElement, unthemedListViewStyles } from "./listViewElement.ts";

export const meta: StoryMeta = {
    title: "ListViewElement",
};

function makeRow(id: string, text: string): TextLabelElement {
    const row = new TextLabelElement(text);
    row.id = id;
    return row;
}

/**
 * Стресс: 100 000 строк (10k групп × 9 детей). Скролл, PageUp/PageDown,
 * Home/End, сворачивание — всё должно оставаться мгновенным: layout и render
 * трогают только видимое окно.
 */
export function stress100k(ctx: StoryContext): void {
    ctx.body.title = "ListViewElement — 100k rows (PgUp/PgDn/Home/End, Space to collapse)";
    const list = new ListViewElement();
    list.setStyles({ ...unthemedListViewStyles, hoverBg: packRgb(42, 45, 46) });

    for (let g = 0; g < 10_000; g++) {
        const groupId = `group-${g}`;
        list.appendRow(makeRow(groupId, `group ${g}`), { label: `group ${g}` });
        for (let c = 0; c < 9; c++) {
            list.appendRow(makeRow(`${groupId}/c${c}`, `item ${g}.${c}`), {
                parentId: groupId,
                label: `item ${g}.${c}`,
            });
        }
    }

    ctx.body.setContent(new ScrollBarDecorator(list));
    ctx.afterRun(() => {
        list.focus();
    });
}

/**
 * Стриминговый append: пачки строк доливаются таймером, как результаты поиска.
 * Скролл, курсор и collapse-состояние не должны сбрасываться дозаписью.
 */
export function streamingAppend(ctx: StoryContext): void {
    ctx.body.title = "ListViewElement — streaming append (1k rows/tick)";
    const list = new ListViewElement();
    list.setStyles(unthemedListViewStyles);
    ctx.body.setContent(new ScrollBarDecorator(list));

    let next = 0;
    const timer = setInterval(() => {
        if (next >= 50_000) {
            clearInterval(timer);
            return;
        }
        for (let i = 0; i < 1_000; i++) {
            const id = `row-${next++}`;
            list.appendRow(makeRow(id, id), { label: id });
        }
        list.markDirty();
    }, 100);
    timer.unref();

    ctx.afterRun(() => {
        list.focus();
    });
}

/**
 * Строки «как в поиске»: файл-группы и матчи с посимвольной подсветкой.
 * Визуальная проверка оверлея выделения: подсветка совпадения и приглушённый
 * номер строки должны переживать курсор/выделение.
 */
export function searchLike(ctx: StoryContext): void {
    ctx.body.title = "ListViewElement — search-like rows (arrows, Space to collapse)";
    const DIM = packRgb(128, 128, 128);
    const MATCH_FG = packRgb(0, 0, 0);
    const MATCH_BG = packRgb(234, 92, 0);

    const list = new ListViewElement();
    list.setStyles({ ...unthemedListViewStyles, hoverBg: packRgb(42, 45, 46) });

    const files = ["src/main.ts", "src/app/editor.ts", "docs/README.md"];
    for (const file of files) {
        const fileRow = makeRow(file, `${file}  3`);
        fileRow.setCharStyle(file.length + 2, { fg: DIM });
        list.appendRow(fileRow, { label: file });

        for (let line = 1; line <= 3; line++) {
            const lineNo = String(line * 7);
            const before = "const value = ";
            const inside = "needle";
            const text = `${lineNo}  ${before}${inside}(42)`;
            const row = makeRow(`${file}:${line}`, text);
            for (let i = 0; i < lineNo.length; i++) row.setCharStyle(i, { fg: DIM });
            const insideStart = lineNo.length + 2 + before.length;
            for (let i = 0; i < inside.length; i++) {
                row.setCharStyle(insideStart + i, { fg: MATCH_FG, bg: MATCH_BG });
            }
            list.appendRow(row, { parentId: file, label: inside });
        }
    }

    ctx.body.setContent(new ScrollBarDecorator(list));
    ctx.afterRun(() => {
        list.focus();
    });
}
