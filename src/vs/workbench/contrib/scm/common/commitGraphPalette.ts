import type { GraphStyleProvider } from "./commitGraph.ts";
import { GRAPH_DEFAULT_STYLE } from "./commitGraph.ts";

/**
 * Модель vscode, а не lazygit (`md5(автор) → HSL` truecolor мимо тем): цвет у дорожки;
 * коммит с текущей или remote-веткой перекрашивает дорожку в семантический цвет;
 * новая дорожка берёт следующий цвет палитры по кругу.
 */

/** Colorblind-safe палитра, как в vscode. */
export const GRAPH_PALETTE = [
    "scmGraph.foreground1",
    "scmGraph.foreground2",
    "scmGraph.foreground3",
    "scmGraph.foreground4",
    "scmGraph.foreground5",
] as const;

export const GRAPH_CURRENT_REF_STYLE = "scmGraph.historyItemRefColor";
export const GRAPH_REMOTE_REF_STYLE = "scmGraph.historyItemRemoteRefColor";

export interface IGraphPaletteCommit {
    readonly sha: string;
    readonly refs: readonly { readonly kind: "head" | "remote" | "tag"; readonly current: boolean }[];
}

export interface IGraphPalette {
    readonly styleFor: GraphStyleProvider;
    /** До укладки — дефолт. */
    colorOf(sha: string): string;
}

/** `undefined` — цвет наследуется или берётся из палитры. */
function semanticStyle(commit: IGraphPaletteCommit | undefined): string | undefined {
    if (commit === undefined) return undefined;
    if (commit.refs.some((ref) => ref.current)) return GRAPH_CURRENT_REF_STYLE;
    if (commit.refs.some((ref) => ref.kind === "remote")) return GRAPH_REMOTE_REF_STYLE;
    return undefined;
}

/** Счётчик цвета живёт внутри: на каждую укладку — свежая палитра, иначе цвета не воспроизводимы. */
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
        if (style === null) {
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
