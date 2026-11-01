import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { fuzzyMatchBest, fuzzyMatchPrepared, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { comparePositions, type IPosition } from "../../../../editor/common/core/iPosition.ts";
import { type IRange, rangeContainsPosition } from "../../../../editor/common/core/iRange.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type {
    ILanguageFeatureTarget,
    LanguageFeatureRegistry,
} from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    DocumentSymbolProvider,
    ICoreDocumentSymbol,
    IDocumentSymbolRequest,
} from "../../../../editor/common/languages/iDocumentSymbolSource.ts";
import {
    symbolKindCodicon,
    symbolKindGroup,
    SymbolTagDeprecated,
} from "../../../../editor/common/languages/symbolKinds.ts";
import type { IExternalDecorations } from "../../../../editor/common/model/iEditorDecoration.ts";
import { EMPTY_EXTERNAL_DECORATIONS } from "../../../../editor/common/model/iEditorDecoration.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { IQuickAccessProvider, QuickAccessHideReason, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import { toMatchRanges } from "./pathMatchRanges.ts";

const SCOPE_PREFIX = ":";
const NO_EDITOR = "To go to a symbol, first open a text editor with symbol information.";
const NO_PROVIDER = "The active text editor does not provide symbol information.";
const NO_SYMBOLS = "No editor symbols";
const NO_MATCHING_SYMBOLS = "No matching editor symbols";

/** The part of `EditorViewState` the picker moves and restores. */
export interface IGotoSymbolViewState {
    scrollTop: number;
    get selections(): readonly ISelection[];
    set selections(value: readonly ISelection[]);
    readonly primaryCursorLine: number;
    readonly primaryCursorColumn: number;
    revealRangeNearBottom(range: IRange): void;
    getCollapsedFolds(): readonly number[];
    restoreCollapsedFolds(startLines: readonly number[]): void;
    goToPosition(line: number, character?: number): void;
}

export interface IGotoSymbolEditor extends ILanguageFeatureTarget {
    readonly viewState: IGotoSymbolViewState;
    readonly versionId: number;
    setDecorations(decorations: IExternalDecorations): void;
}

export interface IGotoSymbolEditorSource {
    getActiveEditor(): IGotoSymbolEditor | null;
}

export const GotoSymbolEditorSourceDIToken = token<IGotoSymbolEditorSource>("GotoSymbolEditorSource");

export const GotoSymbolQuickAccessProviderDIToken = token<GotoSymbolQuickAccessProvider>(
    "GotoSymbolQuickAccessProvider",
);

/** One row's worth of a symbol: upstream `DocumentSymbol` after `OutlineModel.asListOfDocumentSymbols`. */
export interface IFlatDocumentSymbol {
    readonly name: string;
    readonly kind: number;
    readonly deprecated: boolean;
    readonly containerName: string;
    readonly range: IRange;
    readonly selectionRange: IRange;
}

/** Upstream `asListOfDocumentSymbols`: depth first, the parent's name as the container, then in document order. */
export function flattenDocumentSymbols(roots: readonly ICoreDocumentSymbol[]): IFlatDocumentSymbol[] {
    const bucket: IFlatDocumentSymbol[] = [];
    const visit = (entries: readonly ICoreDocumentSymbol[], parentName: string): void => {
        for (const entry of entries) {
            bucket.push({
                name: entry.name.trim(),
                kind: entry.kind,
                deprecated: entry.tags.includes(SymbolTagDeprecated),
                containerName: entry.containerName ?? parentName,
                range: entry.range,
                selectionRange: entry.selectionRange,
            });
            visit(entry.children, entry.name);
        }
    };
    visit(roots, "");
    return bucket.sort(
        (a, b) => comparePositions(a.range.start, b.range.start) || comparePositions(b.range.end, a.range.end),
    );
}

/** The first provider by order with a non-empty answer; a failing one counts as empty. */
export async function getDocumentSymbols(
    registry: LanguageFeatureRegistry<DocumentSymbolProvider>,
    target: ILanguageFeatureTarget,
    request: IDocumentSymbolRequest,
    cancellation: ICancellationToken,
): Promise<readonly ICoreDocumentSymbol[]> {
    for (const provider of registry.ordered(target)) {
        const symbols = await provider.provideDocumentSymbols(request, cancellation).catch(() => []);
        if (symbols.length > 0) return symbols;
    }
    return [];
}

interface IParsedQuery {
    /** Without the `@`, trimmed. */
    readonly original: string;
    /** `@:` groups by kind. */
    readonly scoped: boolean;
    /** Without the scope character. */
    readonly text: string;
}

function parseQuery(query: string): IParsedQuery {
    const original = query.slice(GotoSymbolQuickAccessProvider.PREFIX.length).trim();
    const scoped = original.startsWith(SCOPE_PREFIX);
    return { original, scoped, text: scoped ? original.slice(SCOPE_PREFIX.length).trim() : original };
}

interface ISymbolMatch {
    readonly score: number;
    readonly nameIndices: readonly number[];
    readonly containerIndices: readonly number[];
}

/**
 * Upstream `doGetSymbolPicks`: the whole query may match the name ("change log" for a markdown heading);
 * otherwise the first word is for the symbol and the rest for its container.
 */
function matchSymbol(symbol: IFlatDocumentSymbol, text: string): ISymbolMatch | null {
    const whole = fuzzyMatchBest(text, symbol.name);
    if (whole !== null) return { score: whole.score, nameIndices: whole.matchedIndices, containerIndices: [] };
    const [first, ...rest] = text.split(/\s/);
    const name = fuzzyMatchBest(first, symbol.name);
    if (name === null) return null;
    const container = fuzzyMatchPrepared(prepareQuery(rest.join(" ")), symbol.containerName);
    if (container === null) return null;
    return {
        score: name.score + container.score,
        nameIndices: name.matchedIndices,
        containerIndices: container.matchedIndices,
    };
}

interface IGotoSymbolItem extends QuickAccessItem {
    readonly symbol: IFlatDocumentSymbol;
}

interface IRankedSymbol {
    readonly symbol: IFlatDocumentSymbol;
    readonly documentIndex: number;
    readonly match: ISymbolMatch | null;
}

function compareByScore(a: IRankedSymbol, b: IRankedSymbol): number {
    return (b.match?.score ?? 0) - (a.match?.score ?? 0) || a.documentIndex - b.documentIndex;
}

function compareByKindAndScore(a: IRankedSymbol, b: IRankedSymbol): number {
    return symbolKindGroup(a.symbol.kind).localeCompare(symbolKindGroup(b.symbol.kind)) || compareByScore(a, b);
}

function isSymbolItem(item: QuickAccessItem | undefined): item is IGotoSymbolItem {
    return item !== undefined && "symbol" in item;
}

type SymbolsState =
    | { readonly phase: "noEditor" | "noProvider" | "loading" }
    | { readonly phase: "ready"; readonly symbols: readonly IFlatDocumentSymbol[] };

/**
 * Upstream `AbstractGotoSymbolQuickAccessProvider`. Symbols are asked for once per show and filtered on every
 * key. The widget has no separators, strikethrough or busy indicator: a group name is the `hint` of its first
 * row (as tasks do), a deprecated symbol says so in its label, and the list is empty while the answer is on
 * its way.
 */
export class GotoSymbolQuickAccessProvider implements IQuickAccessProvider {
    public static readonly PREFIX = "@";

    public static dependencies = [
        GotoSymbolEditorSourceDIToken,
        LanguageFeaturesServiceDIToken,
        JumpRecorderDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private state: SymbolsState = { phase: "noEditor" };
    private editor: IGotoSymbolEditor | null = null;
    private restore: (() => void) | null = null;
    /** A preview unfolds only the region of the symbol it shows, not every one it passed. */
    private restoreFolds: (() => void) | null = null;
    private cursor: IPosition | null = null;
    private request: CancellationTokenSource | null = null;
    private registryListener: IDisposable | null = null;

    public constructor(
        private readonly editorSource: IGotoSymbolEditorSource,
        private readonly languageFeatures: Pick<ILanguageFeaturesService, "documentSymbolProvider">,
        private readonly jumps: IJumpRecorder,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {}

    public getPlaceholder(): string {
        return "Type the name of a symbol to go to.";
    }

    public onShow(refresh: (preserveSelection: boolean) => void): void {
        const editor = this.editorSource.getActiveEditor();
        this.editor = editor;
        if (editor === null) {
            this.state = { phase: "noEditor" };
            return;
        }
        const { viewState } = editor;
        const scrollTop = viewState.scrollTop;
        const selections = [...viewState.selections];
        const folds = viewState.getCollapsedFolds();
        this.restoreFolds = () => {
            viewState.restoreCollapsedFolds(folds);
        };
        this.restore = () => {
            viewState.restoreCollapsedFolds(folds);
            viewState.selections = selections;
            viewState.scrollTop = scrollTop;
        };
        this.cursor = { line: viewState.primaryCursorLine, character: viewState.primaryCursorColumn };

        const registry = this.languageFeatures.documentSymbolProvider;
        if (registry.has(editor)) {
            this.load(editor, refresh);
            return;
        }
        // Upstream `waitForLanguageSymbolRegistry`: the picker may have opened before the extension registered.
        this.state = { phase: "noProvider" };
        this.registryListener = registry.onDidChange(() => {
            if (!registry.has(editor)) return;
            this.clearRegistryListener();
            this.load(editor, refresh);
            refresh(false);
        });
    }

    public onHide(reason: QuickAccessHideReason): void {
        this.clearRegistryListener();
        this.request?.cancel();
        this.request = null;
        this.editor?.setDecorations(EMPTY_EXTERNAL_DECORATIONS);
        (reason === "cancel" ? this.restore : this.restoreFolds)?.();
        this.restore = null;
        this.restoreFolds = null;
        this.editor = null;
    }

    public getItems(query: string): QuickAccessItem[] {
        switch (this.state.phase) {
            case "noEditor":
                return [{ label: NO_EDITOR }];
            case "noProvider":
                return [{ label: NO_PROVIDER }];
            case "loading":
                return [];
            case "ready":
                return this.buildItems(this.state.symbols, parseQuery(query));
        }
    }

    /** Upstream `positionToEnclose`: the last symbol around the cursor, only for the list the picker opens with. */
    public getInitialActiveIndex(items: readonly QuickAccessItem[], query: string): number | undefined {
        const cursor = this.cursor;
        if (this.state.phase !== "ready" || cursor === null) return undefined;
        this.cursor = null;
        if (parseQuery(query).original !== "") return undefined;
        const index = items.findLastIndex(
            (item) => isSymbolItem(item) && rangeContainsPosition(item.symbol.range, cursor),
        );
        return index < 0 ? undefined : index;
    }

    /** Upstream `onDidChangeActive`: reveal and light up the line; the selection stays until accept. */
    public onActiveItemChanged(item: QuickAccessItem | undefined): void {
        if (!isSymbolItem(item) || this.editor === null) return;
        const { selectionRange } = item.symbol;
        this.restoreFolds?.();
        this.editor.viewState.revealRangeNearBottom(selectionRange);
        const line = selectionRange.start.line;
        this.editor.setDecorations({
            lineBackgrounds: [{ startLine: line, endLine: line, colorToken: "editor.rangeHighlightBackground" }],
        });
    }

    private clearRegistryListener(): void {
        this.registryListener?.dispose();
        this.registryListener = null;
    }

    private load(editor: IGotoSymbolEditor, refresh: (preserveSelection: boolean) => void): void {
        this.state = { phase: "loading" };
        const request = new CancellationTokenSource();
        this.request = request;
        void getDocumentSymbols(
            this.languageFeatures.documentSymbolProvider,
            editor,
            { uri: editor.uri.toString(), languageId: editor.languageId, versionId: editor.versionId },
            request.token,
        ).then((symbols) => {
            if (request.token.isCancellationRequested) return;
            this.state = { phase: "ready", symbols: flattenDocumentSymbols(symbols) };
            refresh(false);
        });
    }

    private buildItems(symbols: readonly IFlatDocumentSymbol[], query: IParsedQuery): QuickAccessItem[] {
        const ranked = symbols.flatMap((symbol, documentIndex): IRankedSymbol[] => {
            if (query.text === "") return [{ symbol, documentIndex, match: null }];
            const match = matchSymbol(symbol, query.text);
            return match === null ? [] : [{ symbol, documentIndex, match }];
        });
        if (ranked.length === 0) {
            return [{ label: query.original === "" ? NO_SYMBOLS : NO_MATCHING_SYMBOLS }];
        }
        ranked.sort(query.scoped ? compareByKindAndScore : compareByScore);
        const hints = query.scoped ? kindHints(ranked) : new Map([[0, `symbols (${String(ranked.length)})`]]);
        return ranked.map((entry, index) => this.buildItem(entry, hints.get(index)));
    }

    private buildItem({ symbol, match }: IRankedSymbol, hint: string | undefined): IGotoSymbolItem {
        const { start } = symbol.selectionRange;
        // `onHide` has let go of the editor by the time an accept runs.
        const editor = this.editor;
        return {
            symbol,
            icon: this.icons.codicon(symbolKindCodicon(symbol.kind)),
            label: symbol.deprecated ? `${symbol.name} (deprecated)` : symbol.name,
            ...(symbol.containerName !== "" ? { description: symbol.containerName } : {}),
            ...(hint !== undefined ? { hint } : {}),
            // As upstream: a deprecated row has no highlights.
            ...(match !== null && !symbol.deprecated
                ? {
                      labelMatchRanges: toMatchRanges(match.nameIndices),
                      descriptionMatchRanges: toMatchRanges(match.containerIndices),
                  }
                : {}),
            accept: () => {
                this.jumps.jump(() => {
                    editor?.viewState.goToPosition(start.line, start.character);
                });
            },
        };
    }
}

/** A separator per run of one kind, as upstream: `Null` shares `properties` with `Property` but not a run. */
function kindHints(ranked: readonly IRankedSymbol[]): Map<number, string> {
    const hints = new Map<number, string>();
    let start = 0;
    for (let index = 1; index <= ranked.length; index++) {
        if (index < ranked.length && ranked[index].symbol.kind === ranked[start].symbol.kind) continue;
        hints.set(start, `${symbolKindGroup(ranked[start].symbol.kind)} (${String(index - start)})`);
        start = index;
    }
    return hints;
}
