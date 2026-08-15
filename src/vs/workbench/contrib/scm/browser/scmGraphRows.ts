import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import type { IGraphLine } from "../common/commitGraph.ts";
import { GRAPH_CURRENT_REF_STYLE, GRAPH_REMOTE_REF_STYLE } from "../common/commitGraphPalette.ts";

import type { IScmCommit, IScmCommitRef } from "./graphService.ts";

/**
 * Строки view GRAPH: `[граф][бейджи refs][subject]`. Колонки sha здесь нет —
 * в сайдбаре шириной ~30 хеш вытеснил бы тему коммита, а достать его можно
 * командой Copy Commit ID.
 *
 * Графика **не выравнивается в колонку**: у каждой строки своя ширина, и текст
 * идёт сразу за её последней дорожкой (как в lazygit). Выравнивание по
 * максимуму превратило бы список в таблицу и в узкой истории с одним-двумя
 * ветвлениями отодвинуло бы все темы вправо ради пары строк.
 */

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
 * Кладёт строку графа в лейбл: её собственный текст плюс цвет каждого символа.
 *
 * Ширина строки — `2 * (число дорожек)` и от выделения не зависит: подсветка
 * меняет символы, но не число клеток. Поэтому лейбл не «прыгает», когда курсор
 * ходит по списку. Последняя клетка всегда отдаёт пробел-соединитель — он же
 * служит разделителем до бейджей и темы коммита.
 */
export function applyGraphLine(label: TextLabelElement, line: IGraphLine): void {
    label.setText(line.text);
    label.clearCharStyles();
    for (let i = 0; i < line.styles.length; i++) {
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
 * Строка коммита: график по своей ширине, бейджи по содержимому и тема коммита
 * на весь остаток. Id строки — полный sha (идентичность в списке и аргумент
 * команд контекстного меню).
 */
export function buildCommitRow(commit: IScmCommit, line: IGraphLine, commitStyle: string): IScmGraphRowParts {
    const root = new HFlexElement();
    root.id = commit.sha;

    const graph = new TextLabelElement("");
    applyGraphLine(graph, line);
    root.addChild(graph, { width: hflexFit(), height: 1 });

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
 * продолжается (как «Load More» в vscode). `indent` — ширина графики последней
 * строки: так надпись встаёт ровно под её темой, а не липнет к краю.
 */
export function buildLoadMoreRow(indent: number): HFlexElement {
    const root = new HFlexElement();
    root.id = LOAD_MORE_ROW_ID;
    root.addChild(new TextLabelElement("".padEnd(indent, " ")), {
        width: hflexFixed(indent),
        height: 1,
    });
    const label = new TextLabelElement(LOAD_MORE_LABEL);
    label.style = { fg: "descriptionForeground" };
    root.addChild(label, { width: hflexFill(), height: 1 });
    return root;
}
