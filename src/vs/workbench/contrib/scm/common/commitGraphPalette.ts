import type { GraphStyleProvider, IGraphCommit } from "./commitGraph.ts";
import { GRAPH_DEFAULT_STYLE } from "./commitGraph.ts";

/**
 * Раздача цветов линиям графа. lazygit красит линию по `md5(имя автора) → HSL`
 * truecolor — мимо системы тем, поэтому здесь модель vscode: коммит, несущий
 * текущую ветку или remote-ветку, задаёт своей линии семантический цвет, все
 * остальные разбирают палитру из пяти токенов по кругу.
 *
 * Цвет закрепляется за коммитом, который линию **начал**, и тянется по ней вниз
 * до конца — продолжение и терминатор копируют стиль предыдущего пайпа
 * ({@link getNextPipes}).
 */

/** Пять цветов линий по кругу — colorblind-safe палитра, как в vscode. */
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

/** Семантический цвет по ref'ам коммита; `undefined` — цвет берётся из палитры. */
function semanticStyle(commit: IGraphPaletteCommit): string | undefined {
    if (commit.refs.some((ref) => ref.current)) return GRAPH_CURRENT_REF_STYLE;
    if (commit.refs.some((ref) => ref.kind === "remote")) return GRAPH_REMOTE_REF_STYLE;
    return undefined;
}

/**
 * Провайдер цвета для {@link renderCommitGraph}. Цвета раздаются заранее, одним
 * проходом по списку — так результат не зависит от того, сколько раз алгоритм
 * спросит цвет одного и того же коммита (merge спрашивает на каждого родителя).
 */
export function createGraphStyleProvider(commits: readonly IGraphPaletteCommit[]): GraphStyleProvider {
    const styleByHash = new Map<string, string>();
    let colorIndex = -1;
    for (const commit of commits) {
        if (styleByHash.has(commit.sha)) continue;
        const semantic = semanticStyle(commit);
        if (semantic !== undefined) {
            styleByHash.set(commit.sha, semantic);
            continue;
        }
        colorIndex = (colorIndex + 1) % GRAPH_PALETTE.length;
        styleByHash.set(commit.sha, GRAPH_PALETTE[colorIndex]);
    }
    return (commit: IGraphCommit): string => styleByHash.get(commit.sha) ?? GRAPH_DEFAULT_STYLE;
}
