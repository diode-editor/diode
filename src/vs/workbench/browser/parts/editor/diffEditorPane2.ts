import type { IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { DefaultLinesDiffComputer } from "../../../../editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import { DiffInnerRanges } from "../../../../editor/common/diff/diffInnerRanges.ts";
import { DiffViewModel } from "../../../../editor/common/diff/diffViewModel.ts";
import type { IDiffV2SideLayout } from "../../../../editor/common/diff/diffV2Layout.ts";
import { computeDiffV2Layout } from "../../../../editor/common/diff/diffV2Layout.ts";
import type { DiffSide } from "../../../../editor/common/diff/diffViewText.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import { Component } from "../../component.ts";

import { DiffPaneElement } from "./diffPaneElement.ts";
import type { IDiffEditorPaneInput } from "./diffEditorPane.ts";
import { EditorComponent } from "./editorComponent.ts";
import type { IEditorPane } from "./iEditorPane.ts";
import { TextEditorPane } from "./textEditorPane.ts";

/** Максимум времени на дифф; сверх — грубый результат вместо залипшей вкладки. */
const MAX_DIFF_COMPUTATION_MS = 2000;

/** Разбор текста на строки: EOL любого вида, как в `TextDocument`. */
const EOL_SPLIT = /\r\n|\n/;

/**
 * Дифф-вкладка v2 (docs/TODO/DiffEditable.md, PR-3): **композиция двух
 * настоящих редакторов** — каждая сторона это `TextFileModel`-снимок +
 * `EditorComponent`, обёрнутые в `TextEditorPane`. Выравнивание сторон — зоны
 * (view zones), свёртка unchanged — обычный фолдинг, подсветка — внешние
 * декорации; всю раскладку считает `computeDiffV2Layout`.
 *
 * Поэтому каретка, выделение, копирование, PageUp/Home, фолдинг мышью — код
 * редактора, а не вторая реализация; `EditorService.getActiveEditor()` на этой
 * вкладке отдаёт её активную сторону, так что и командные пути работают.
 *
 * В PR-3 вкладка — **снимок** (обе стороны read-only); живой пересчёт и
 * миграция всех входов — PR-4.
 */
export class DiffEditorPane2 extends Component implements IEditorPane {
    public readonly uri: Uri;
    public readonly label: string;
    public readonly view: TUIElement;
    public readonly isModified = false;
    /** Правка запрещена по устройству панели — вкладка носит метку-замок. */
    public readonly readOnly = true;
    public readonly originalUri: Uri | null;
    public readonly modifiedUri: Uri | null;

    private readonly sides: Record<DiffSide, TextEditorPane>;
    private activeSideValue: DiffSide = "modified";
    /** Пары регионов свёртки для синхронизации разворота между сторонами. */
    private regionPairs: { original: number; modified: number; collapsed: boolean }[] = [];
    private layout: { original: IDiffV2SideLayout; modified: IDiffV2SideLayout } | null = null;
    /** Реэнтрантный гард зеркалирования скролла и фолд-синка. */
    private syncing = false;

    public constructor(
        private readonly languageService: ILanguageService,
        private readonly undoRedoService: UndoRedoService,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        input: IDiffEditorPaneInput,
    ) {
        super();
        this.uri = input.uri;
        this.label = input.label;
        this.originalUri = input.originalUri ?? null;
        this.modifiedUri = input.modifiedUri ?? null;

        this.sides = {
            original: this.createSide("original", tokenizationRegistry, tokenStyleResolver, input),
            modified: this.createSide("modified", tokenizationRegistry, tokenStyleResolver, input),
        };
        this.view = new DiffPaneElement(this.sides.original.component.view, this.sides.modified.component.view);
        this.view.id = "diffEditorV2";
        this.view.style = { fg: "editor.foreground", bg: "editor.background" };
        // Одна полоса прокрутки на пару: скролл синхронен, левая была бы дублем
        // и съедала бы колонку текста.
        this.sides.original.component.view.verticalScrollBar = "never";

        this.applyDiff(input);
        this.wireSync();

        this.register({
            dispose: () => {
                // Стороны владеют моделями и компонентами (TextEditorPane
                // регистрирует их в конструкторе) — диспозим стороны.
                this.sides.original.dispose();
                this.sides.modified.dispose();
                // view из дерева НЕ отцепляем: как и у первой панели, это
                // делает контент-слот группы при смене контента.
            },
        });
    }

    /** Сторона: синтетическая модель-снимок + компонент + текстовая панель. */
    private createSide(
        side: DiffSide,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        input: IDiffEditorPaneInput,
    ): TextEditorPane {
        const model = new TextFileModel(this.languageService, this.undoRedoService);
        // Ресурс стороны — синтетический и уникальный: пара + сторона.
        model.openSynthetic(
            Uri.from({ scheme: "vexx-diff-side", path: input.uri.path, query: input.uri.query, fragment: side }),
            input.languageId,
        );
        const component = new EditorComponent(tokenizationRegistry, tokenStyleResolver, model);
        component.foldingOwnedExternally = true;
        const pane = new TextEditorPane(model, component);
        pane.detached = true;
        pane.labelOverride = side === "original" ? input.originalLabel : input.modifiedLabel;
        pane.readOnly = true;
        return pane;
    }

    /** Пересчёт диффа и раскладки сторон из свежего снимка. */
    public setInput(input: IDiffEditorPaneInput): void {
        this.applyDiff(input);
    }

    private applyDiff(input: IDiffEditorPaneInput): void {
        const originalLines = input.originalText.split(EOL_SPLIT);
        const modifiedLines = input.modifiedText.split(EOL_SPLIT);

        this.syncing = true;
        try {
            // replaceOwnedContent пересоздаёт view-state компонента (reload
            // "owned") — зоны/фолды/декорации перезаливаются ниже по свежему
            // расчёту, поэтому порядок важен: сначала контент, потом раскладка.
            this.sides.original.model.replaceOwnedContent(input.originalText);
            this.sides.modified.model.replaceOwnedContent(input.modifiedText);
            this.sides.original.readOnly = true;
            this.sides.modified.readOnly = true;

            const diff = new DefaultLinesDiffComputer().computeDiff(originalLines, modifiedLines, {
                ignoreTrimWhitespace: false,
                maxComputationTimeMs: MAX_DIFF_COMPUTATION_MS,
                computeMoves: false,
            });
            const model = new DiffViewModel(diff.changes, originalLines.length, modifiedLines.length, {
                hideUnchangedRegions: true,
            });
            this.layout = computeDiffV2Layout(diff.changes, model.regions, new DiffInnerRanges(diff.changes), {
                original: originalLines.length,
                modified: modifiedLines.length,
            });
            this.regionPairs = this.layout.original.foldingRegions.map((region, i) => ({
                original: region.startLine,
                /* v8 ignore start -- ?? недостижим: регионы сторон парные по построению computeDiffV2Layout */
                modified: this.layout?.modified.foldingRegions[i]?.startLine ?? region.startLine,
                /* v8 ignore stop */
                collapsed: true,
            }));
            this.applySideLayout("original");
            this.applySideLayout("modified");
        } finally {
            this.syncing = false;
        }
    }

    /** Заливает стороне зоны/фолды/декорации с учётом текущего collapsed-состояния пар. */
    private applySideLayout(side: DiffSide): void {
        const layout = this.layout;
        /* v8 ignore start -- defensive: зовётся только после applyDiff */
        if (layout === null) return;
        /* v8 ignore stop */
        const sideLayout = layout[side];
        const viewState = this.sides[side].viewState;

        const collapsedByStart = new Map(this.regionPairs.map((pair) => [pair[side], pair.collapsed]));
        const folding = sideLayout.foldingRegions.map((region) => ({
            startLine: region.startLine,
            endLine: region.endLine,
            /* v8 ignore start -- ?? недостижим: пары построены из этих же регионов */
            isCollapsed: collapsedByStart.get(region.startLine) ?? true,
            /* v8 ignore stop */
        }));
        viewState.setFoldingRegions(folding);

        // Плашка живёт только у свёрнутого куска: развёрнутый показывает сами
        // строки, и парная зона с обеих сторон исчезает согласованно.
        const plaqueAnchors = new Set(
            sideLayout.decorations.zones
                ?.filter((zone) => zone.text !== undefined)
                /* v8 ignore start -- ?? недостижим: computeSide всегда отдаёт массив зон-декораций */
                .map((zone) => zone.afterLine) ?? [],
                /* v8 ignore stop */
        );
        const collapsedPlaques = new Set<number>();
        for (let i = 0; i < sideLayout.foldingRegions.length; i++) {
            if (folding[i].isCollapsed) {
                for (const anchor of plaqueAnchors) {
                    if (anchor >= folding[i].startLine && anchor <= folding[i].endLine) collapsedPlaques.add(anchor);
                }
            }
        }
        viewState.setViewZones(
            sideLayout.zones.filter((zone) => !plaqueAnchors.has(zone.afterLine) || collapsedPlaques.has(zone.afterLine)),
        );
        this.sides[side].component.setDecorations({
            ...sideLayout.decorations,
            zones: sideLayout.decorations.zones?.filter(
                (zone) => zone.text === undefined || collapsedPlaques.has(zone.afterLine),
            ),
        });
    }

    /** Синхронизация: скролл зеркалится, разворот свёртки — парный. */
    private wireSync(): void {
        for (const side of ["original", "modified"] as const) {
            const other: DiffSide = side === "original" ? "modified" : "original";
            this.register(
                this.sides[side].viewState.onDidChangeView(() => {
                    if (this.syncing) return;
                    this.syncing = true;
                    try {
                        this.syncFoldingFrom(side);
                        this.sides[other].viewState.scrollTop = this.sides[side].viewState.scrollTop;
                        this.sides[other].viewState.scrollLeft = this.sides[side].viewState.scrollLeft;
                    } finally {
                        this.syncing = false;
                    }
                }),
            );
            // Активная сторона — по фокусу внутри её view.
            this.sides[side].component.view.addEventListener(
                "focus",
                () => {
                    this.activeSideValue = side;
                },
                { capture: true },
            );
        }
    }

    /** Разворот/свёртка куска на одной стороне применяется к паре. */
    private syncFoldingFrom(side: DiffSide): void {
        const own = this.sides[side].viewState.foldedRegions;
        let changed = false;
        for (const pair of this.regionPairs) {
            const region = own.find((r) => r.startLine === pair[side]);
            if (region !== undefined && region.isCollapsed !== pair.collapsed) {
                pair.collapsed = region.isCollapsed;
                changed = true;
            }
        }
        if (changed) {
            this.applySideLayout("original");
            this.applySideLayout("modified");
        }
    }

    // ─── IEditorPane ──────────────────────────────────────────────────────────

    /** Сторона, в которой живут каретка и команды. */
    public get activeSide(): DiffSide {
        return this.activeSideValue;
    }

    /** Активная сторона как настоящая текстовая панель — для getActiveEditor(). */
    public get activeTextPane(): TextEditorPane {
        return this.sides[this.activeSideValue];
    }

    /** Содержимое статично (снимок), перерисовывать таб-стрип не по чему. */
    public onDidChangeState(): IDisposable {
        return { dispose: () => undefined };
    }

    public focusEditor(): void {
        this.sides[this.activeSideValue].component.focus();
    }

    public get viewState(): EditorViewState {
        return this.sides[this.activeSideValue].viewState;
    }

    public getSelectedText(): string {
        // Стороны — настоящие документы: плейсхолдеров и филлеров в тексте нет,
        // фильтровать нечего.
        return this.viewState.getSelectedText();
    }
}
