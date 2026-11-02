import * as nodePath from "node:path";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { CancellationTokenNone, LatestRequest } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { comparePositions } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { findWordRangeAt } from "../../../../editor/common/core/wordClassification.ts";
import type { GlobalFeatureRegistry } from "../../../../editor/common/globalFeatureRegistry.ts";
import type {
    ICoreWorkspaceSymbol,
    WorkspaceSymbolProvider,
} from "../../../../editor/common/languages/iWorkspaceSymbolSource.ts";
import { SymbolKind, symbolKindCodicon, SymbolTagDeprecated } from "../../../../editor/common/languages/symbolKinds.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IExternalOpener } from "../../../services/externalOpener/common/iExternalOpener.ts";
import { ExternalOpenerDIToken } from "../../../services/externalOpener/common/iExternalOpener.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import { type ISymbolMatch, matchSymbol } from "./gotoSymbolQuickAccessProvider.ts";
import { toMatchRanges } from "./pathMatchRanges.ts";

/** Upstream `TYPING_SEARCH_DELAY`: the user types a word, then stops to start searching. */
const TYPING_SEARCH_DELAY_MS = 200;
const NO_PROVIDERS = "No workspace symbol providers";
const NO_MATCHING_SYMBOLS = "No matching workspace symbols";

/** Upstream `TREAT_AS_GLOBAL_SYMBOL_TYPES`. */
const GLOBAL_SYMBOL_KINDS: ReadonlySet<number> = new Set([
    SymbolKind.Class,
    SymbolKind.Enum,
    SymbolKind.File,
    SymbolKind.Interface,
    SymbolKind.Namespace,
    SymbolKind.Package,
    SymbolKind.Module,
]);

export const WorkspaceSymbolsQuickAccessProviderDIToken = token<WorkspaceSymbolsQuickAccessProvider>(
    "WorkspaceSymbolsQuickAccessProvider",
);

export interface IWorkspaceSymbolItem {
    readonly symbol: ICoreWorkspaceSymbol;
    readonly provider: WorkspaceSymbolProvider;
}

function compareStrings(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

/** Upstream `Range.areIntersecting`: touching ranges do not intersect. */
function rangesIntersect(a: IRange, b: IRange): boolean {
    return comparePositions(a.end, b.start) > 0 && comparePositions(b.end, a.start) > 0;
}

/** Upstream's order inside `getWorkspaceSymbols`; zero means the same symbol. */
function compareItems(a: IWorkspaceSymbolItem, b: IWorkspaceSymbolItem): number {
    const first = a.symbol;
    const second = b.symbol;
    let result = compareStrings(first.name, second.name) || first.kind - second.kind;
    result ||= compareStrings(first.location.uri, second.location.uri);
    if (result !== 0) return result;
    const firstRange = first.location.range;
    const secondRange = second.location.range;
    if (firstRange !== undefined && secondRange !== undefined) {
        if (!rangesIntersect(firstRange, secondRange)) {
            result =
                comparePositions(firstRange.start, secondRange.start) ||
                comparePositions(firstRange.end, secondRange.end);
        }
    } else {
        // As upstream, this only orders them: with and without resolve they stay two symbols.
        result =
            Number(b.provider.resolveWorkspaceSymbol !== undefined) -
            Number(a.provider.resolveWorkspaceSymbol !== undefined);
    }
    return result || compareStrings(first.containerName ?? "", second.containerName ?? "");
}

/** Upstream `getWorkspaceSymbols`: all providers in parallel, a failing one counts as empty, duplicates dropped. */
export async function getWorkspaceSymbols(
    registry: GlobalFeatureRegistry<WorkspaceSymbolProvider>,
    query: string,
    cancellation: ICancellationToken,
): Promise<IWorkspaceSymbolItem[]> {
    const answers = await Promise.all(
        registry.all().map(async (provider) => {
            const symbols = await provider.provideWorkspaceSymbols(query, cancellation).catch(() => []);
            return symbols.map((symbol): IWorkspaceSymbolItem => ({ symbol, provider }));
        }),
    );
    const sorted = answers.flat().sort(compareItems);
    return sorted.filter((item, index) => index === 0 || compareItems(sorted[index - 1], item) !== 0);
}

export interface ISymbolPickOptions {
    /** Upstream `skipLocal`: only what reads as global without its container. */
    readonly skipLocal?: boolean;
}

interface IRankedSymbol {
    readonly item: IWorkspaceSymbolItem;
    readonly match: ISymbolMatch | null;
    readonly containerLabel: string;
}

/** Upstream `compareSymbols`: by score, by name, by the kind's icon. */
function compareRanked(a: IRankedSymbol, b: IRankedSymbol): number {
    return (
        (b.match?.score ?? 0) - (a.match?.score ?? 0) ||
        a.item.symbol.name.toLowerCase().localeCompare(b.item.symbol.name.toLowerCase()) ||
        symbolKindCodicon(a.item.symbol.kind).localeCompare(symbolKindCodicon(b.item.symbol.kind))
    );
}

/**
 * Upstream `SymbolsQuickAccessProvider`. Providers filter on the server, so every query is a request: 200 ms
 * after typing (on top of the picker's own debounce), superseding the previous one, whose rows stay until the
 * answer. The widget has no strikethrough: a deprecated symbol says so in its label. No preview, as upstream.
 */
export class WorkspaceSymbolsQuickAccessProvider implements IQuickAccessProvider {
    public static readonly PREFIX = "#";

    public static dependencies = [
        LanguageFeaturesServiceDIToken,
        EditorServiceDIToken,
        JumpRecorderDIToken,
        IWorkspaceContextServiceDIToken,
        ExternalOpenerDIToken,
        ProductIconServiceDIToken,
    ] as const;

    public readonly debounceQuery = true;

    private readonly latest = new LatestRequest();
    private searchTimer: ReturnType<typeof setTimeout> | undefined;
    private registryListener: IDisposable | null = null;
    private requestedQuery: string | null = null;
    private rows: readonly QuickAccessItem[] = [];
    private refresh: (preserveSelection: boolean) => void = () => undefined;

    public constructor(
        private readonly languageFeatures: Pick<ILanguageFeaturesService, "workspaceSymbolProvider">,
        private readonly editors: Pick<IEditorService, "getActiveEditor" | "openUri">,
        private readonly jumps: IJumpRecorder,
        private readonly workspace: Pick<IWorkspaceContextService, "getWorkspaceFolder">,
        private readonly opener: IExternalOpener,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {}

    public getPlaceholder(): string {
        return "Type the name of a symbol to open.";
    }

    /** Upstream `getSelectionSearchString`: a single-line selection, otherwise the word under the cursor. */
    public getDefaultFilterValue(): string | undefined {
        const editor = this.editors.getActiveEditor();
        if (editor === null) return undefined;
        const { viewState } = editor;
        const selected = viewState.getSelectedText();
        if (selected.includes("\n")) return undefined;
        if (selected !== "") return selected;
        const line = editor.getLinesContent()[viewState.primaryCursorLine];
        const word = findWordRangeAt(line, viewState.primaryCursorColumn);
        return word === null ? undefined : line.slice(word.start, word.end);
    }

    public onShow(refresh: (preserveSelection: boolean) => void): void {
        this.refresh = refresh;
        // The picker may have opened before the extension registered.
        this.registryListener = this.languageFeatures.workspaceSymbolProvider.onDidChange(() => {
            this.requestedQuery = null;
            refresh(false);
        });
    }

    public onHide(): void {
        this.cancelSearch();
        this.registryListener?.dispose();
        this.registryListener = null;
        this.requestedQuery = null;
        this.rows = [];
    }

    public getItems(query: string): QuickAccessItem[] {
        if (this.languageFeatures.workspaceSymbolProvider.all().length === 0) return [{ label: NO_PROVIDERS }];
        if (query !== this.requestedQuery) {
            this.requestedQuery = query;
            const filter = query.slice(WorkspaceSymbolsQuickAccessProvider.PREFIX.length).trim();
            this.search(filter, {}, (rows) => {
                this.rows = rows.length === 0 && filter !== "" ? [{ label: NO_MATCHING_SYMBOLS }] : rows;
                this.refresh(false);
            });
        }
        return [...this.rows];
    }

    /** The delayed request both this picker and the files picker make; only the latest one answers. */
    public search(
        filter: string,
        options: ISymbolPickOptions,
        onResults: (rows: readonly QuickAccessItem[]) => void,
    ): void {
        clearTimeout(this.searchTimer);
        const ticket = this.latest.start();
        this.searchTimer = setTimeout(() => {
            void this.getSymbolPicks(filter, options, ticket.token).then((rows) => {
                if (ticket.isStale()) return;
                ticket.done();
                onResults(rows);
            });
        }, TYPING_SEARCH_DELAY_MS);
    }

    public cancelSearch(): void {
        clearTimeout(this.searchTimer);
        this.latest.cancel();
    }

    private async getSymbolPicks(
        filter: string,
        options: ISymbolPickOptions,
        cancellation: ICancellationToken,
    ): Promise<QuickAccessItem[]> {
        // Of several words only the first goes to the server: the rest narrow by container here.
        const [symbolQuery] = filter.split(/\s/);
        const items = await getWorkspaceSymbols(
            this.languageFeatures.workspaceSymbolProvider,
            symbolQuery,
            cancellation,
        );
        const ranked = items.flatMap((item): IRankedSymbol[] => {
            const { symbol } = item;
            const containerName = symbol.containerName ?? "";
            if (options.skipLocal === true && !GLOBAL_SYMBOL_KINDS.has(symbol.kind) && containerName !== "") return [];
            const path = this.pathOf(Uri.parse(symbol.location.uri));
            const containerLabel = containerName === "" ? path : `${containerName} • ${path}`;
            if (filter === "") return [{ item, match: null, containerLabel }];
            const match = matchSymbol(symbol.name, containerLabel, filter);
            return match === null ? [] : [{ item, match, containerLabel }];
        });
        return ranked.sort(compareRanked).map((entry) => this.buildRow(entry));
    }

    /** Upstream `getUriLabel(uri, { relative: true })`: relative to its folder, absolute outside, whole if not a file. */
    private pathOf(uri: Uri): string {
        if (uri.scheme !== "file") return uri.toString();
        const folder = this.workspace.getWorkspaceFolder(uri);
        if (folder === null) return uri.fsPath;
        return nodePath.relative(folder.uri.fsPath, uri.fsPath).split(nodePath.sep).join("/");
    }

    private buildRow({ item, match, containerLabel }: IRankedSymbol): QuickAccessItem {
        const { symbol } = item;
        const deprecated = symbol.tags.includes(SymbolTagDeprecated);
        return {
            icon: this.icons.codicon(symbolKindCodicon(symbol.kind)),
            label: deprecated ? `${symbol.name} (deprecated)` : symbol.name,
            description: containerLabel,
            // As upstream: a deprecated row has no highlights.
            ...(match !== null && !deprecated
                ? {
                      labelMatchRanges: toMatchRanges(match.nameIndices),
                      descriptionMatchRanges: toMatchRanges(match.containerIndices),
                  }
                : {}),
            accept: () => {
                void this.open(item);
            },
        };
    }

    /** Upstream `openSymbol`. The picker has closed by now, so the request is not tied to its life. */
    private async open({ symbol, provider }: IWorkspaceSymbolItem): Promise<void> {
        const resolved = await provider.resolveWorkspaceSymbol?.(symbol, CancellationTokenNone);
        const location = resolved ?? symbol.location;
        const uri = Uri.parse(location.uri);
        if (uri.scheme === "http" || uri.scheme === "https") {
            await this.opener.open(uri.toString());
            return;
        }
        await this.jumps.jumpAsync(async () => {
            await this.editors.openUri(uri);
            const { range } = location;
            const editor = this.editors.getActiveEditor();
            // The resource may have failed to open (see `DefinitionService`), then the active editor is another one.
            if (range === undefined || editor?.uri.toString() !== uri.toString()) return;
            editor.goToPosition(range.start.line, range.start.character);
            editor.revealRange(range);
        });
    }
}
