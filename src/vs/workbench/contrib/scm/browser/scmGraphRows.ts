import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import type { IGraphLine } from "../common/commitGraph.ts";
import { GRAPH_CURRENT_REF_STYLE, GRAPH_REMOTE_REF_STYLE } from "../common/commitGraphPalette.ts";

import type { IScmCommit, IScmCommitRef } from "./graphService.ts";

/**
 * Строки view GRAPH: `[граф][бейджи refs][subject]`. Колонки sha здесь нет —
 * в сайдбаре шириной ~30 хеш вытеснил бы тему коммита, а достать его можно
 * командой Copy Commit ID.
 */

/**
 * Потолок ширины графовой колонки. Клетка занимает два знака, так что 14 —
 * это семь дорожек; глубже ветвление в сайдбаре всё равно нечитаемо, а тема
 * коммита важнее.
 */
export const GRAPH_MAX_WIDTH = 14;

/** Потолок колонки бейджей — дальше они схлопываются в `+N`. */
export const REFS_MAX_WIDTH = 20;

/** Id строки-догрузки: e2e-селектор `#id` матчит только `[A-Za-z0-9_-]`. */
export const LOAD_MORE_ROW_ID = "scmGraphLoadMore";

export const LOAD_MORE_LABEL = "Load More…";

/**
 * Части строки коммита. Возвращаются вместе, чтобы перерисовать графовую
 * колонку при смене выделения, не пересобирая строку целиком.
 */
export interface IScmGraphRowParts {
    readonly root: HFlexElement;
    readonly graph: TextLabelElement;
    readonly subject: TextLabelElement;
}

/**
 * Ширина графовой колонки — общая для всех строк: у каждой строки она своя,
 * и без выравнивания по максимуму бейджи с темами разъехались бы по вертикали.
 */
export function graphColumnWidth(lines: readonly IGraphLine[]): number {
    let max = 0;
    for (const line of lines) {
        if (line.text.length > max) max = line.text.length;
    }
    return Math.min(max, GRAPH_MAX_WIDTH);
}

/** Кладёт строку графа в лейбл: текст по ширине колонки + цвет каждого символа. */
export function applyGraphLine(label: TextLabelElement, line: IGraphLine, width: number): void {
    const chars = [...line.text].slice(0, width);
    label.setText(chars.join("").padEnd(width, " "));
    label.clearCharStyles();
    for (let i = 0; i < chars.length; i++) {
        const style = line.styles[i];
        if (style !== undefined) label.setCharStyle(i, { fg: style });
    }
}

/** Порядок бейджей как в vscode: текущая ветка → remote → локальные → теги. */
const REF_ORDER: Record<IScmCommitRef["kind"], number> = { remote: 1, head: 2, tag: 3 };

function refRank(ref: IScmCommitRef): number {
    return ref.current ? 0 : REF_ORDER[ref.kind];
}

/**
 * Цвет бейджа: текущая ветка и remote — семантические цвета, остальные (теги и
 * прочие локальные ветки) красятся цветом линии своего коммита (правило vscode).
 */
function refStyle(ref: IScmCommitRef, commitStyle: string): string {
    if (ref.current) return GRAPH_CURRENT_REF_STYLE;
    if (ref.kind === "remote") return GRAPH_REMOTE_REF_STYLE;
    return commitStyle;
}

/**
 * Текст и посимвольные цвета колонки бейджей. Не влезающие в
 * {@link REFS_MAX_WIDTH} схлопываются в `+N` — иначе длинный список веток
 * съел бы тему коммита целиком.
 */
export function buildRefsLabel(
    refs: readonly IScmCommitRef[],
    commitStyle: string,
): { text: string; styles: (string | undefined)[] } {
    if (refs.length === 0) return { text: "", styles: [] };

    const sorted = [...refs].sort((a, b) => refRank(a) - refRank(b));
    let text = "";
    const styles: (string | undefined)[] = [];
    let shown = 0;

    for (const ref of sorted) {
        const piece = shown === 0 ? ref.name : ` ${ref.name}`;
        // Первый бейдж показываем всегда: пустая колонка полезнее, чем «+N»
        // без единого имени.
        if (shown > 0 && text.length + piece.length > REFS_MAX_WIDTH) break;
        const style = refStyle(ref, commitStyle);
        text += piece;
        for (let i = 0; i < piece.length; i++) styles.push(style);
        shown++;
    }

    const hidden = sorted.length - shown;
    if (hidden > 0) {
        const piece = ` +${hidden}`;
        text += piece;
        for (let i = 0; i < piece.length; i++) styles.push("descriptionForeground");
    }

    // Разделитель до темы коммита — вне подсветки бейджей.
    text += " ";
    styles.push(undefined);
    return { text, styles };
}

/**
 * Строка коммита: графовая колонка фиксированной ширины, бейджи по содержимому
 * и тема коммита на весь остаток. Id строки — полный sha (идентичность в
 * списке и аргумент команд контекстного меню).
 */
export function buildCommitRow(
    commit: IScmCommit,
    line: IGraphLine,
    graphWidth: number,
    commitStyle: string,
): IScmGraphRowParts {
    const root = new HFlexElement();
    root.id = commit.sha;

    const graph = new TextLabelElement("");
    applyGraphLine(graph, line, graphWidth);
    root.addChild(graph, { width: hflexFixed(graphWidth), height: 1 });

    const refs = buildRefsLabel(commit.refs, commitStyle);
    if (refs.text !== "") {
        const refsLabel = new TextLabelElement(refs.text);
        for (let i = 0; i < refs.styles.length; i++) {
            const style = refs.styles[i];
            if (style !== undefined) refsLabel.setCharStyle(i, { fg: style });
        }
        root.addChild(refsLabel, { width: hflexFit(), height: 1 });
    }

    const subject = new TextLabelElement(commit.subject);
    root.addChild(subject, { width: hflexFill(), height: 1 });

    return { root, graph, subject };
}

/**
 * Строка догрузки под последним коммитом — появляется, только пока история
 * продолжается (как «Load More» в vscode). Отступ слева выравнивает её по
 * колонке тем коммитов.
 */
export function buildLoadMoreRow(graphWidth: number): HFlexElement {
    const root = new HFlexElement();
    root.id = LOAD_MORE_ROW_ID;
    root.addChild(new TextLabelElement("".padEnd(graphWidth, " ")), {
        width: hflexFixed(graphWidth),
        height: 1,
    });
    const label = new TextLabelElement(LOAD_MORE_LABEL);
    label.style = { fg: "descriptionForeground" };
    root.addChild(label, { width: hflexFill(), height: 1 });
    return root;
}
