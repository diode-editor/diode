import type { GraphStyleProvider } from "./commitGraph.ts";
import { GRAPH_DEFAULT_STYLE } from "./commitGraph.ts";

/**
 * Раздача цветов дорожкам графа. lazygit красит линию по `md5(имя автора) → HSL`
 * truecolor — мимо системы тем, поэтому здесь модель vscode:
 *
 * - цвет принадлежит **дорожке**, а не коммиту: продолжение ветки наследует
 *   цвет линии, которую продолжает (иначе каждый коммит линейной истории был бы
 *   своего цвета);
 * - коммит, несущий текущую ветку или remote-ветку, перекрашивает свою дорожку
 *   в семантический цвет — так HEAD-ветку видно в любом месте графа;
 * - новая дорожка (первый коммит списка, влитая ветка, несвязанный корень)
 *   берёт следующий цвет из палитры по кругу.
 */

/** Пять цветов дорожек по кругу — colorblind-safe палитра, как в vscode. */
export const GRAPH_PALETTE = [
    "scmGraph.foreground1",
    "scmGraph.foreground2",
    "scmGraph.foreground3",
    "scmGraph.foreground4",
    "scmGraph.foreground5",
] as const;

export const GRAPH_CURRENT_REF_STYLE = "scmGraph.historyItemRefColor";
export const GRAPH_REMOTE_REF_STYLE = "scmGraph.historyItemRemoteRefColor";

/**
 * Минимум, который палитре нужен от коммита. Структурно совместим с моделью
 * `IScmCommit` — тащить её в этот слой не требуется.
 */
export interface IGraphPaletteCommit {
    readonly sha: string;
    readonly refs: readonly { readonly kind: "head" | "remote" | "tag"; readonly current: boolean }[];
}

/** Палитра одной укладки: провайдер для алгоритма + итоговые цвета для бейджей. */
export interface IGraphPalette {
    /** Провайдер цвета линий — отдаётся в `renderCommitGraph`. */
    readonly styleFor: GraphStyleProvider;
    /** Цвет дорожки коммита после укладки; до неё — дефолт. */
    colorOf(sha: string): string;
}

/** Семантический цвет по ref'ам коммита; `undefined` — цвет наследуется/берётся из палитры. */
function semanticStyle(commit: IGraphPaletteCommit | undefined): string | undefined {
    if (commit === undefined) return undefined;
    if (commit.refs.some((ref) => ref.current)) return GRAPH_CURRENT_REF_STYLE;
    if (commit.refs.some((ref) => ref.kind === "remote")) return GRAPH_REMOTE_REF_STYLE;
    return undefined;
}

/**
 * Палитра для одной укладки графа. Счётчик цвета живёт внутри и крутится в
 * порядке появления новых дорожек — как `rot(colorIndex + 1)` в vscode; чтобы
 * результат был воспроизводим, на каждую укладку берут свежую палитру.
 */
export function createGraphPalette(commits: readonly IGraphPaletteCommit[]): IGraphPalette {
    const byHash = new Map<string, IGraphPaletteCommit>();
    for (const commit of commits) {
        if (!byHash.has(commit.sha)) byHash.set(commit.sha, commit);
    }

    const assigned = new Map<string, string>();
    let colorIndex = -1;

    const styleFor: GraphStyleProvider = (sha, inherited) => {
        const semantic = semanticStyle(byHash.get(sha));
        let style = semantic ?? inherited;
        if (style === undefined || style === null) {
            colorIndex = (colorIndex + 1) % GRAPH_PALETTE.length;
            style = GRAPH_PALETTE[colorIndex];
        }
        // Первое присвоение побеждает: дорожку к влитой ветке заводит merge, а
        // сам её коммит приходит ниже и должен остаться того же цвета.
        if (!assigned.has(sha)) assigned.set(sha, style);
        return style;
    };

    return {
        styleFor,
        colorOf: (sha) => assigned.get(sha) ?? GRAPH_DEFAULT_STYLE,
    };
}
