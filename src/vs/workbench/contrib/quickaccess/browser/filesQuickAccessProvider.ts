import * as nodePath from "node:path";

import type { PreparedQuery } from "../../../../base/common/fuzzySearch.ts";
import { fuzzyMatchPrepared, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import { MutableDisposable } from "../../../../base/common/lifecycle.ts";
import type { ParsedGoto } from "../../../../base/common/lineColumnQuery.ts";
import { splitFileQuery } from "../../../../base/common/lineColumnQuery.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { EditorHistoryService } from "../../../services/history/browser/editorHistoryService.ts";
import { EditorHistoryServiceDIToken } from "../../../services/history/browser/editorHistoryService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { FileSearchResult, IFileSearchService } from "../../../services/search/common/fileSearch.ts";
import { FileSearchServiceDIToken } from "../../../services/search/common/fileSearch.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import type { IGotoLineEditorSource } from "./gotoLineQuickAccessProvider.ts";
import { GotoLineEditorSourceDIToken, navigateActiveEditor } from "./gotoLineQuickAccessProvider.ts";
import { splitPathMatchRanges } from "./pathMatchRanges.ts";

export const FilesQuickAccessProviderDIToken = token<FilesQuickAccessProvider>("FilesQuickAccessProvider");

export type IEditorHistory = Pick<EditorHistoryService, "getHistory" | "removeMissing">;

interface HistoryEntry {
    readonly absolutePath: string;
    readonly label: string;
    /** `""` for a file at the folder root. */
    readonly description: string;
}

interface MatchedHistoryEntry {
    readonly entry: HistoryEntry;
    readonly score: number;
    /** Into {@link searchTextOf}. */
    readonly matchedIndices: readonly number[];
}

export class FilesQuickAccessProvider implements IQuickAccessProvider {
    public static readonly PREFIX = "";

    public static dependencies = [
        FileSearchServiceDIToken,
        CommandRegistryDIToken,
        GotoLineEditorSourceDIToken,
        JumpRecorderDIToken,
        EditorHistoryServiceDIToken,
        IConfigurationServiceDIToken,
        IWorkspaceContextServiceDIToken,
        ProductIconServiceDIToken,
    ] as const;

    public readonly debounceQuery = true;

    private readonly indexSubscription = new MutableDisposable();

    public constructor(
        private readonly fileSearch: IFileSearchService,
        private readonly commands: CommandRegistry,
        private readonly editorSource: IGotoLineEditorSource,
        private readonly jumps: IJumpRecorder,
        private readonly history: IEditorHistory,
        private readonly configuration: Pick<IConfigurationService, "get">,
        private readonly workspace: Pick<IWorkspaceContextService, "getWorkspaceFolder">,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {}

    public getPlaceholder(): string {
        return "Go to File...";
    }

    public onShow(refresh: (preserveSelection: boolean) => void): void {
        // The list is shown at once; a file found gone a moment later drops out of it.
        void this.history.removeMissing().then((removed) => {
            if (removed) refresh(true);
        });
        this.fileSearch.refreshIfStale();
        this.indexSubscription.value = this.fileSearch.onIndexChanged(() => {
            // The list grew in the background for the same query — keep the cursor.
            refresh(true);
        });
    }

    public onHide(): void {
        this.indexSubscription.clear();
    }

    /**
     * Upstream `AnythingQuickAccessProvider.getEditorHistoryPicks` above the file results: without a
     * query only the history, with one the matching history first, then search results without repeats.
     */
    public getItems(query: string): QuickAccessItem[] {
        const { filePart, goto } = splitFileQuery(query);
        const filter = prepareQuery(filePart);
        if (filter.terms.length === 0) {
            return this.historyEntries().map((entry) =>
                this.buildHistoryItem({ entry, score: 0, matchedIndices: [] }, goto),
            );
        }

        const history = this.configuration.get("search.quickOpen.includeHistory")
            ? this.matchHistory(filter, /[\\/]/.test(filePart))
            : [];
        const shown = new Set(history.map((match) => match.entry.absolutePath));
        const results = this.fileSearch.search(filePart, 50).filter((r) => !shown.has(r.entry.absolutePath));
        return [...history.map((match) => this.buildHistoryItem(match, goto)), ...this.buildFileItems(results, goto)];
    }

    /** By name only unless the query has a path separator, as upstream (`labelOnlyEditorHistoryPickAccessor`). */
    private matchHistory(filter: PreparedQuery, byPath: boolean): MatchedHistoryEntry[] {
        const matched = this.historyEntries().flatMap((entry) => {
            const searchText = searchTextOf(entry);
            const match = fuzzyMatchPrepared(filter, byPath ? searchText : entry.label);
            if (match === null) return [];
            const offset = byPath ? 0 : searchText.length - entry.label.length;
            return [{ entry, score: match.score, matchedIndices: match.matchedIndices.map((index) => index + offset) }];
        });
        if (this.configuration.get("search.quickOpen.history.filterSortOrder") === "recency") return matched;
        // The sort is stable: on equal scores the more recent file stays first.
        return matched.sort((a, b) => b.score - a.score);
    }

    private historyEntries(): HistoryEntry[] {
        return this.history.getHistory().map((uri) => this.describe(uri));
    }

    private describe(uri: Uri): HistoryEntry {
        const absolutePath = uri.fsPath;
        return { absolutePath, label: nodePath.basename(absolutePath), description: this.directoryOf(uri) };
    }

    /** As in the Open Editors picker: relative to the file's folder, absolute outside every folder. */
    private directoryOf(uri: Uri): string {
        const directory = nodePath.dirname(uri.fsPath);
        const folder = this.workspace.getWorkspaceFolder(uri);
        if (folder === null) return directory;
        return nodePath.relative(folder.uri.fsPath, directory).split(nodePath.sep).join("/");
    }

    private buildHistoryItem(match: MatchedHistoryEntry, goto: ParsedGoto | null): QuickAccessItem {
        const { entry } = match;
        const { labelRanges, descriptionRanges } = splitPathMatchRanges(
            match.matchedIndices,
            searchTextOf(entry).length - entry.label.length,
        );
        return {
            icon: this.icons.fileIcon(entry.label)?.icon,
            label: entry.label,
            description: entry.description,
            labelMatchRanges: labelRanges,
            descriptionMatchRanges: descriptionRanges,
            accept: () => {
                this.open(entry.absolutePath, goto);
            },
        };
    }

    private buildFileItems(results: FileSearchResult[], goto: ParsedGoto | null): QuickAccessItem[] {
        return results.map((r) => {
            const basename = nodePath.basename(r.entry.relativePath);
            const dir = nodePath.dirname(r.entry.relativePath);

            const { labelRanges, descriptionRanges } = splitPathMatchRanges(
                r.matchedIndices,
                r.entry.relativePath.length - basename.length,
            );

            const absolutePath = r.entry.absolutePath;
            return {
                icon: this.icons.fileIcon(basename)?.icon,
                label: basename,
                description: dir === "." ? "" : dir,
                labelMatchRanges: labelRanges,
                descriptionMatchRanges: descriptionRanges,
                accept: () => {
                    this.open(absolutePath, goto);
                },
            };
        });
    }

    private open(absolutePath: string, goto: ParsedGoto | null): void {
        // Opening and jumping are one navigation-history entry
        // (otherwise Back would land at the top of the just-opened file).
        this.jumps.jump(() => {
            this.commands.execute("workbench.openFile", absolutePath);
            // Read the active editor *after* the file opened above so a
            // `file:line` accept jumps in the just-opened editor.
            if (goto !== null) {
                navigateActiveEditor(this.editorSource, goto.line, goto.column);
            }
        });
    }
}

function searchTextOf(entry: HistoryEntry): string {
    return entry.description === "" ? entry.label : `${entry.description}/${entry.label}`;
}
