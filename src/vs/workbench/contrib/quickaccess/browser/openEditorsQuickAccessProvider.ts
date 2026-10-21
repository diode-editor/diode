import * as nodePath from "node:path";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import type { PreparedQuery } from "../../../../base/common/fuzzySearch.ts";
import { fuzzyMatchPrepared, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { BASENAME_BONUS } from "../../../services/search/common/fileSearch.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import { splitPathMatchRanges } from "./pathMatchRanges.ts";

export interface IOpenEditorsSource {
    getOpenEditorsMru(): readonly IEditorPane[];
    displayName(editor: IEditorPane): string;
    revealPane(editor: IEditorPane): void;
}

// Stryker disable StringLiteral: token() returns a new Token and dependencies resolve by reference to it — the string inside is only a debug label
export const OpenEditorsSourceDIToken = token<IOpenEditorsSource>("OpenEditorsSource");
export const OpenEditorsQuickAccessProviderDIToken = token<OpenEditorsQuickAccessProvider>(
    "OpenEditorsQuickAccessProvider",
);
// Stryker restore StringLiteral

const MODIFIED_MARKER = "●";

interface OpenEditorEntry {
    readonly pane: IEditorPane;
    readonly label: string;
    /** `""` for the root or a non-file. */
    readonly description: string;
}

interface MatchedEntry {
    readonly entry: OpenEditorEntry;
    readonly score: number;
    readonly matchedIndices: readonly number[];
}

/** No debounce or live updates: tens of tabs, the list is built on every query. */
export class OpenEditorsQuickAccessProvider implements IQuickAccessProvider {
    /** With a space, as in vscode: `edt` without it stays a file query. */
    public static readonly PREFIX = "edt ";

    public static dependencies = [OpenEditorsSourceDIToken, IWorkspaceContextServiceDIToken] as const;

    public constructor(
        private readonly editors: IOpenEditorsSource,
        private readonly workspace: IWorkspaceContextService,
    ) {}

    public getPlaceholder(): string {
        return "Show All Opened Editors";
    }

    public getItems(query: string): QuickAccessItem[] {
        const entries = this.editors.getOpenEditorsMru().map((pane) => this.describe(pane));
        if (entries.length === 0) {
            // An informational row without accept — like the Go-to-Line hint: an empty
            // list would look like a broken picker.
            return [{ label: "No opened editors" }];
        }

        // The prefix is cut BEFORE splitting on spaces: it ends with a space itself, and `edt`
        // would remain a separate term that no tab matches.
        const filter = prepareQuery(query.slice(OpenEditorsQuickAccessProvider.PREFIX.length));
        const matched = entries.flatMap((entry) => {
            const match = matchEntry(entry, filter);
            return match === null ? [] : [match];
        });
        // The sort is stable, so on equal scores (in particular for an
        // empty query) the order stays the source's MRU order.
        matched.sort((a, b) => b.score - a.score);
        return matched.map((match) => this.buildItem(match));
    }

    private describe(pane: IEditorPane): OpenEditorEntry {
        return { pane, label: this.editors.displayName(pane), description: this.directoryOf(pane) };
    }

    /** A file outside the root, or a workspace without a root, gets an absolute path: `../../..` reads worse. */
    private directoryOf(pane: IEditorPane): string {
        // Gate on the scheme, not on an empty path: fsPath of a non-file scheme (untitled,
        // output, a diff side) returns garbage rather than throwing.
        if (pane.uri.scheme !== "file") return "";

        const directory = nodePath.dirname(pane.uri.fsPath);
        // `null` both for an empty window and for a file outside the folders — no `../` check needed.
        const folder = this.workspace.getWorkspaceFolder(pane.uri);
        if (folder === null) return directory;
        const relative = nodePath.relative(folder.uri.fsPath, directory);
        return relative.split(nodePath.sep).join("/");
    }

    private buildItem(match: MatchedEntry): QuickAccessItem {
        const { entry } = match;
        const { labelRanges, descriptionRanges } = splitPathMatchRanges(
            match.matchedIndices,
            searchTextOf(entry).length - entry.label.length,
        );
        return {
            icon: getFileIcon(entry.label).icon,
            label: entry.label,
            description: entry.description,
            hint: entry.pane.isModified ? MODIFIED_MARKER : undefined,
            labelMatchRanges: labelRanges,
            descriptionMatchRanges: descriptionRanges,
            accept: () => {
                this.editors.revealPane(entry.pane);
            },
        };
    }
}

function searchTextOf(entry: OpenEditorEntry): string {
    return entry.description === "" ? entry.label : `${entry.description}/${entry.label}`;
}

/** Like `FileSearchService.search`: a match in the name gets {@link BASENAME_BONUS}, otherwise match by path. */
function matchEntry(entry: OpenEditorEntry, filter: PreparedQuery): MatchedEntry | null {
    const searchText = searchTextOf(entry);
    const offset = searchText.length - entry.label.length;

    const byName = fuzzyMatchPrepared(filter, entry.label);
    if (byName !== null) {
        return {
            entry,
            score: byName.score + BASENAME_BONUS,
            matchedIndices: byName.matchedIndices.map((index) => index + offset),
        };
    }

    const byPath = fuzzyMatchPrepared(filter, searchText);
    if (byPath === null) return null;
    return { entry, score: byPath.score, matchedIndices: byPath.matchedIndices };
}
