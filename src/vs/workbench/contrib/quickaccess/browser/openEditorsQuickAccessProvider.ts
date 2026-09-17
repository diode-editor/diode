import * as nodePath from "node:path";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import { fuzzyMatchBest } from "../../../../base/common/fuzzySearch.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { BASENAME_BONUS } from "../../../services/search/node/fileSearchService.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import { splitPathMatchRanges } from "./pathMatchRanges.ts";

/**
 * Открытые редакторы глазами пикера: список вкладок всех групп в MRU-порядке,
 * их метки и переход на выбранную. `EditorService` соответствует шву
 * структурно; связывание — в `diode/modules/workbenchModule.ts`.
 */
export interface IOpenEditorsSource {
    getOpenEditorsMru(): readonly IEditorPane[];
    displayName(editor: IEditorPane): string;
    revealPane(editor: IEditorPane): void;
}

/**
 * Корень воркспейса — чтобы путь в описании строки был относительным, как в
 * файловом пикере, а не абсолютным. Структурно соответствует `ExplorerService`
 * (он владеет корнем и переживает Open Folder); связывание — в DI-модуле.
 */
export interface IWorkspaceRootSource {
    getRootPath(): string | null;
}

// Stryker disable StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const OpenEditorsSourceDIToken = token<IOpenEditorsSource>("OpenEditorsSource");
export const WorkspaceRootSourceDIToken = token<IWorkspaceRootSource>("WorkspaceRootSource");
export const OpenEditorsQuickAccessProviderDIToken = token<OpenEditorsQuickAccessProvider>(
    "OpenEditorsQuickAccessProvider",
);
// Stryker restore StringLiteral

/** Маркер несохранённых правок в строке пикера — та же точка, что во вкладке. */
const MODIFIED_MARKER = "●";

/** Строка пикера до фильтрации: вкладка плюс то, по чему её ищут и показывают. */
interface OpenEditorEntry {
    readonly pane: IEditorPane;
    /** Метка вкладки: имя файла (у безымянного буфера — `Untitled-N`). */
    readonly label: string;
    /** Каталог вкладки относительно корня воркспейса; «» — корень или не файл. */
    readonly description: string;
}

/** Совпадение запроса со строкой: чем выше score, тем ближе к началу списка. */
interface MatchedEntry {
    readonly entry: OpenEditorEntry;
    readonly score: number;
    readonly matchedIndices: readonly number[];
}

/**
 * Пикер открытых редакторов (`edt `, VS Code `workbench.action.showAllEditors`):
 * вкладки всех групп в MRU-порядке с fuzzy-фильтром по имени и пути — тем же,
 * что у файлового пикера (сперва имя файла с {@link BASENAME_BONUS}, иначе весь
 * относительный путь). Соседний Ctrl+Tab показывает тот же MRU-список, но
 * hold-оверлеем без ввода; здесь — обычный список с фильтром.
 *
 * Источник дешёвый (десятки открытых вкладок, никакого индекса), поэтому ни
 * `debounceQuery`, ни живого обновления по `onShow` тут нет: список строится
 * заново на каждый запрос.
 */
export class OpenEditorsQuickAccessProvider implements IQuickAccessProvider {
    /** С пробелом, как у vscode: `edt` без него остаётся запросом к файлам. */
    public static readonly PREFIX = "edt ";

    public static dependencies = [OpenEditorsSourceDIToken, WorkspaceRootSourceDIToken] as const;

    public constructor(
        private readonly editors: IOpenEditorsSource,
        private readonly workspace: IWorkspaceRootSource,
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

        const filter = query.slice(OpenEditorsQuickAccessProvider.PREFIX.length).trim();
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

    /**
     * Каталог вкладки для описания строки: относительно корня воркспейса — как
     * в файловом пикере. Файл вне корня (открыт из CLI по абсолютному пути) и
     * воркспейс без корня показываются абсолютным путём: цепочка `../../..`
     * читается хуже, чем сам путь.
     */
    private directoryOf(pane: IEditorPane): string {
        // Гейт по схеме, а не по пустому пути: fsPath у не-file схемы (untitled,
        // output, сторона диффа) вернёт мусор, а не бросит.
        if (pane.uri.scheme !== "file") return "";

        const directory = nodePath.dirname(pane.uri.fsPath);
        const root = this.workspace.getRootPath();
        if (root === null) return directory;
        const relative = nodePath.relative(root, directory);
        if (relative.startsWith("..")) return directory;
        // Слэш на всех платформах, как у относительных путей файлового пикера.
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

/** Текст, по которому ищут строку: относительный путь вкладки целиком. */
function searchTextOf(entry: OpenEditorEntry): string {
    return entry.description === "" ? entry.label : `${entry.description}/${entry.label}`;
}

/**
 * Матчит запрос со строкой по правилам файлового пикера
 * (`FileSearchService.search`): сперва имя файла — совпадение в нём получает
 * {@link BASENAME_BONUS} и бьёт совпадение только в пути, — иначе весь
 * относительный путь. Пустой запрос отдельной ветки не требует: он совпадает с
 * любым именем на нулевые очки и без подсветки, так что список остаётся целым и
 * в исходном (MRU) порядке.
 */
function matchEntry(entry: OpenEditorEntry, filter: string): MatchedEntry | null {
    const searchText = searchTextOf(entry);
    const offset = searchText.length - entry.label.length;

    const byName = fuzzyMatchBest(filter, entry.label);
    if (byName !== null) {
        return {
            entry,
            score: byName.score + BASENAME_BONUS,
            matchedIndices: byName.matchedIndices.map((index) => index + offset),
        };
    }

    const byPath = fuzzyMatchBest(filter, searchText);
    if (byPath === null) return null;
    return { entry, score: byPath.score, matchedIndices: byPath.matchedIndices };
}
