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

// Stryker disable StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const OpenEditorsSourceDIToken = token<IOpenEditorsSource>("OpenEditorsSource");
export const OpenEditorsQuickAccessProviderDIToken = token<OpenEditorsQuickAccessProvider>(
    "OpenEditorsQuickAccessProvider",
);
// Stryker restore StringLiteral

const MODIFIED_MARKER = "●";

interface OpenEditorEntry {
    readonly pane: IEditorPane;
    readonly label: string;
    /** «» — корень или не файл. */
    readonly description: string;
}

interface MatchedEntry {
    readonly entry: OpenEditorEntry;
    readonly score: number;
    readonly matchedIndices: readonly number[];
}

/** Без debounce и живого обновления: десятки вкладок, список строится на каждый запрос. */
export class OpenEditorsQuickAccessProvider implements IQuickAccessProvider {
    /** С пробелом, как у vscode: `edt` без него остаётся запросом к файлам. */
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
            // Информационная строка без accept — как хинт Go-to-Line: пустой
            // список выглядел бы сломанным пикером.
            return [{ label: "No opened editors" }];
        }

        // Префикс срезается ДО разбора по пробелам: он сам кончается пробелом, и `edt`
        // остался бы отдельным термом, который не проходит ни одна вкладка.
        const filter = prepareQuery(query.slice(OpenEditorsQuickAccessProvider.PREFIX.length));
        const matched = entries.flatMap((entry) => {
            const match = matchEntry(entry, filter);
            return match === null ? [] : [match];
        });
        // Сортировка стабильная, поэтому при равных очках (в частности, у
        // пустого запроса) порядок остаётся MRU-порядком источника.
        matched.sort((a, b) => b.score - a.score);
        return matched.map((match) => this.buildItem(match));
    }

    private describe(pane: IEditorPane): OpenEditorEntry {
        return { pane, label: this.editors.displayName(pane), description: this.directoryOf(pane) };
    }

    /** Файл вне корня и воркспейс без корня — абсолютным путём: `../../..` читается хуже. */
    private directoryOf(pane: IEditorPane): string {
        // Гейт по схеме, а не по пустому пути: fsPath у не-file схемы (untitled,
        // output, сторона диффа) вернёт мусор, а не бросит.
        if (pane.uri.scheme !== "file") return "";

        const directory = nodePath.dirname(pane.uri.fsPath);
        // `null` и на пустое окно, и на файл вне папок — проверка на `../` не нужна.
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

/** Как `FileSearchService.search`: совпадение в имени получает {@link BASENAME_BONUS}, иначе — по пути. */
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
