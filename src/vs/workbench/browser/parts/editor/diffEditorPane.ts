import type { IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { DiffSide, IDiffRowSource } from "../../../../editor/browser/diffViewElement.ts";
import { DiffViewElement } from "../../../../editor/browser/diffViewElement.ts";
import { DefaultLinesDiffComputer } from "../../../../editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import { DiffViewModel } from "../../../../editor/common/diff/diffViewModel.ts";
import { PlainTextTokenizer } from "../../../../editor/common/languages/builtin/plainTextTokenizer.ts";
import type { ILineTokens } from "../../../../editor/common/languages/iLineTokens.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { DocumentTokenStore } from "../../../../editor/common/tokens/documentTokenStore.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemedComponent } from "../../component.ts";

import type { IEditorPane } from "./iEditorPane.ts";

/** Максимум времени на дифф; сверх — грубый результат вместо залипшей вкладки. */
const MAX_DIFF_COMPUTATION_MS = 2000;

export interface IDiffEditorPaneInput {
    /** Ресурс вкладки — он же её идентичность в группе. */
    readonly uri: Uri;
    /** Метка вкладки (напр. `a.ts ↔ HEAD`). */
    readonly label: string;
    readonly originalText: string;
    readonly modifiedText: string;
    /** Язык для подсветки обеих сторон. */
    readonly languageId: string;
}

/**
 * Вкладка с inline-диффом: слева от текста — номера строк обеих сторон, дальше
 * `-`/`+` и содержимое; неизменённые куски свёрнуты (см. {@link DiffViewModel}).
 *
 * Панель **read-only и снимочная**: держит тексты на момент открытия, поэтому
 * `isModified` всегда `false` и вкладка закрывается без диалога сохранения.
 * Живой пересчёт по правкам исходного буфера — отдельная задача (docs/TODO/Diff.md).
 *
 * Владеет двумя `TextDocument` и двумя `DocumentTokenStore` — они нужны только
 * ради подсветки, редактирования здесь нет.
 */
export class DiffEditorPane extends ThemedComponent implements IEditorPane, IDiffRowSource {
    public readonly uri: Uri;
    public readonly label: string;
    public readonly view: ScrollBarDecorator;
    public readonly isModified = false;
    /** Правка невозможна по устройству панели — вкладка носит метку-замок. */
    public readonly readOnly = true;

    private readonly element: DiffViewElement;
    private documents!: Record<DiffSide, TextDocument>;
    private tokenStores!: Record<DiffSide, DocumentTokenStore>;
    private readonly tokenStyleResolver: ITokenStyleResolver;
    private readonly tokenizationRegistry: TokenizationRegistry;

    public constructor(
        themeService: ThemeService,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        input: IDiffEditorPaneInput,
    ) {
        super(themeService);
        this.uri = input.uri;
        this.label = input.label;
        this.tokenStyleResolver = tokenStyleResolver;
        this.tokenizationRegistry = tokenizationRegistry;

        this.element = new DiffViewElement();
        this.view = new ScrollBarDecorator(this.element);
        this.view.id = "diffEditor";
        this.buildFrom(input);

        this.register({
            dispose: () => {
                this.tokenStores.original.dispose();
                this.tokenStores.modified.dispose();
                // view из дерева НЕ отцепляем: пока группа держит его как content,
                // setParent(null) оставляет полуприкреплённое состояние (ребёнок в
                // getChildren с parent=null — ловит validateTree). Отцепляет тот,
                // кто монтировал: контент-слот EditorGroupComponent при смене контента.
            },
        });
        this.initStyles();
    }

    /**
     * Пересобирает дифф из свежего снимка, оставляя ту же вкладку (тот же `uri` и
     * позицию в группе). Нужно потому, что дифф — снимок, а повторный «Compare
     * with HEAD» по тому же ресурсу — единственный доступный пользователю способ
     * его обновить: без этого группа дедупит вкладку по `uri` и он бы смотрел на
     * устаревший результат. Токен-сторы старого снимка утилизируем здесь же.
     */
    public setInput(input: IDiffEditorPaneInput): void {
        this.tokenStores.original.dispose();
        this.tokenStores.modified.dispose();
        this.buildFrom(input);
    }

    /** Документы, токенизация, дифф и строки вью из одного снимка. */
    private buildFrom(input: IDiffEditorPaneInput): void {
        const originalLines = input.originalText.split("\n");
        const modifiedLines = input.modifiedText.split("\n");

        this.documents = {
            original: new TextDocument(input.originalText, input.languageId),
            modified: new TextDocument(input.modifiedText, input.languageId),
        };
        // fire-and-forget: load() не реджектится, до подгрузки грамматики
        // рисуем plaintext'ом — как это делает и обычный редактор.
        void this.tokenizationRegistry.load(input.languageId);
        const support = this.tokenizationRegistry.get(input.languageId) ?? new PlainTextTokenizer();
        this.tokenStores = {
            original: new DocumentTokenStore(this.documents.original, support),
            modified: new DocumentTokenStore(this.documents.modified, support),
        };

        const diff = new DefaultLinesDiffComputer().computeDiff(originalLines, modifiedLines, {
            ignoreTrimWhitespace: false,
            maxComputationTimeMs: MAX_DIFF_COMPUTATION_MS,
            computeMoves: false,
        });
        // Свёрнуто по умолчанию — отклонение от дефолта VS Code, осознанное:
        // в терминале строк на экране мало (см. docs/TODO/Diff.md).
        const model = new DiffViewModel(diff.changes, originalLines.length, modifiedLines.length, {
            hideUnchangedRegions: true,
        });
        this.element.setRows(model.rows, this);
    }

    // ─── IEditorPane ──────────────────────────────────────────────────────────

    /** Содержимое вкладки статично, поэтому перерисовывать таб-стрип не по чему. */
    public onDidChangeState(): IDisposable {
        return { dispose: () => undefined };
    }

    public focusEditor(): void {
        this.element.focus();
    }

    // ─── IDiffRowSource: текст и токены для отрисовки ─────────────────────────

    public getLine(side: DiffSide, line: number): string {
        return this.documents[side].getLineContent(line);
    }

    public getLineTokens(side: DiffSide, line: number): ILineTokens | undefined {
        const store = this.tokenStores[side];
        store.tokenizeUpTo(line);
        return store.getLineTokens(line);
    }

    public resolveTokenStyle(scopes: readonly string[]) {
        return this.tokenStyleResolver.resolve(scopes);
    }

    protected updateStyles(): void {
        const theme = this.theme;
        this.element.setStyles({
            background: theme.getRequiredColor("editor.background"),
            foreground: theme.getRequiredColor("editor.foreground"),
            gutterBackground: theme.getColor("editorGutter.background") ?? theme.getRequiredColor("editor.background"),
            lineNumberForeground: theme.getRequiredColor("editorLineNumber.foreground"),
            insertedLineBackground: theme.getRequiredColor("diffEditor.insertedLineBackground"),
            removedLineBackground: theme.getRequiredColor("diffEditor.removedLineBackground"),
            unchangedRegionForeground: theme.getRequiredColor("diffEditor.unchangedRegionForeground"),
        });
    }
}
