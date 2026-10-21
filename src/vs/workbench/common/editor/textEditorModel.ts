import { Emitter } from "../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import type { EndOfLine } from "../../../editor/common/core/endOfLine.ts";
import type { ISelection } from "../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../editor/common/languages/iLanguageService.ts";
import type { IDocumentLanguageChange } from "../../../editor/common/model/iDocumentLanguageChange.ts";
import type { IUndoElement } from "../../../editor/common/model/iUndoElement.ts";
import { TextDocument, type TextSource } from "../../../editor/common/model/textDocument.ts";
import type { IUndoViewBinding, UndoStepToken } from "../../../editor/common/model/undoManager.ts";
import { UndoManager } from "../../../editor/common/model/undoManager.ts";
import type { ICursorStateComputer } from "../../../editor/common/viewModel/trackedSelections.ts";
import type { IUndoRedoElement } from "../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";

let nextUndoContextId = 1;

/**
 * Правки модели идут через view-state действующей вью — там живут выделения и
 * inverse-edits для undo. Целей несколько (документ в нескольких группах):
 * действующую передаёт вызывающий, `markDirty` вещается всем.
 */
export interface ITextEditTarget {
    cloneSelections(): ISelection[];
    applyEdits(
        edits: readonly ITextEdit[],
        label: string,
        computeCursorState?: ICursorStateComputer,
    ): IUndoElement | undefined;
    markDirty(): void;
}

export abstract class BaseTextEditorModel extends Disposable {
    /**
     * Один на всю жизнь модели: перечитка меняет текст в нём ({@link replaceText}),
     * а не подменяет объект — view, токены и расширения видят её обычной правкой.
     */
    protected readonly doc: TextDocument;
    /**
     * Ретрансляция событий документа ждёт, пока {@link replaceText} согласует
     * «сохранённую» версию, — иначе подписчик увидел бы свежий текст несохранённым.
     */
    private replacingText = false;
    private readonly onDidChangeLanguageEmitter = this.register(new Emitter<IDocumentLanguageChange>());
    private readonly onDidChangeEolEmitter = this.register(new Emitter<void>());
    private readonly onDidChangeContentEmitter = this.register(new Emitter<void>());
    protected uriValue: Uri;
    protected savedVersionId = 0;
    protected savedEol: EndOfLine;
    protected readonly languageService: ILanguageService;
    private readonly undoRedoService: UndoRedoService;
    /** Первая — цель по умолчанию для программных путей без действующей вью (save-участник). */
    private editTargets: ITextEditTarget[] = [];
    /** История одна на документ, сколько бы вью его ни показывало. */
    private readonly undoManagerValue: UndoManager;
    /**
     * Живёт только на синхронное окно вызова: обёртка-элемент в `UndoRedoService`
     * исполняется до первого await внутри `undo(context)`.
     */
    private actingView: IUndoViewBinding | null = null;
    /** Не `null` — шаги забирает вызывающий {@link applyExternalEditsDetached}, а не общий бакет. */
    private detachedUndoSteps: IUndoRedoElement[] | null = null;

    /**
     * Намеренно НЕ путь и НЕ uri: на пути все безымянные буферы сходились в общий
     * бакет `"untitled"`, а `saveAs` осиротлял накопленную историю. Модель одна на
     * документ, поэтому сплит-вью делят историю через неё.
     */
    // Уникальность держится и при счёте вниз (0, -1, …) — мутант ненаблюдаем.
    // Stryker disable next-line UpdateOperator: эквивалентен — см. выше
    public readonly undoContext = `editor-${nextUndoContextId++}`;

    public readonly onDidChangeContent = this.onDidChangeContentEmitter.event;

    public readonly onDidChangeLanguage = this.onDidChangeLanguageEmitter.event;

    /** Любым путём: командой, undo/redo, перечиткой с другим EOL. */
    public readonly onDidChangeEol = this.onDidChangeEolEmitter.event;

    protected constructor(languageService: ILanguageService, undoRedoService: UndoRedoService, uri: Uri) {
        super();

        this.languageService = languageService;
        this.undoRedoService = undoRedoService;
        this.uriValue = uri;

        this.doc = new TextDocument("");
        this.savedEol = this.doc.eol;
        this.bindDocumentListeners();
        this.undoManagerValue = this.createUndoManager();

        this.register({
            dispose: () => {
                this.undoRedoService.clear(this.undoContext);
            },
        });
    }

    public get isModified(): boolean {
        return this.doc.versionId !== this.savedVersionId || this.doc.eol !== this.savedEol;
    }

    public get eol(): EndOfLine {
        return this.doc.eol;
    }

    public get document(): TextDocument {
        return this.doc;
    }

    public get languageId(): string {
        return this.doc.languageId;
    }

    public setLanguage(languageId: string): void {
        this.doc.setLanguage(languageId);
    }

    public get uri(): Uri {
        return this.uriValue;
    }

    public getText(): string {
        return this.doc.getText();
    }

    /** Disposable снимает цель, когда вью закрывается раньше модели (сплиты). */
    public attachEditTarget(target: ITextEditTarget): IDisposable {
        this.editTargets.push(target);
        return {
            dispose: () => {
                const i = this.editTargets.indexOf(target);
                if (i >= 0) this.editTargets.splice(i, 1);
            },
        };
    }

    public get undoManager(): UndoManager {
        return this.undoManagerValue;
    }

    protected broadcastMarkDirty(): void {
        for (const target of [...this.editTargets]) target.markDirty();
    }

    /** `IUndoRedoElement.resources`: у буфера без файла на диске — пусто. */
    protected get undoResources(): string[] {
        return [];
    }

    /**
     * Каждый шаг регистрирует обёртку-токен порядка в `UndoRedoService`; её undo/redo
     * делегируют в {@link UndoManager} (LIFO 1:1, поэтому стеки идут в ногу).
     */
    private createUndoManager(): UndoManager {
        const undoManager = new UndoManager(this.doc);
        undoManager.onDidPush = (element) => {
            const wrapper = this.wrapUndoStep(element.label);
            // Иначе на один workspace edit пришлось бы столько Ctrl+Z, сколько документов он тронул.
            if (this.detachedUndoSteps !== null) {
                this.detachedUndoSteps.push(wrapper);
                return;
            }
            this.undoRedoService.pushElement(wrapper, this.undoContext);
        };
        return undoManager;
    }

    private resetUndoHistory(): void {
        this.undoRedoService.clear(this.undoContext, "replaced");
        this.undoManagerValue.clear();
    }

    /** Шаги нескольких документов, тронувшие файл до открытия буфера, встают и в его историю. */
    protected adoptWorkspaceUndo(resource: string, label: string): void {
        this.undoRedoService.adopt(this.undoContext, resource, label);
    }

    protected markSaved(): void {
        this.savedVersionId = this.doc.versionId;
        this.savedEol = this.doc.eol;
    }

    /**
     * Буфер после этого без истории и чистый, кроме `unsaved` — текст не с диска
     * (правки, переехавшие за перенесённым файлом): «сохранённой» остаётся прежняя версия.
     */
    protected replaceText(text: TextSource, { unsaved = false }: { unsaved?: boolean } = {}): void {
        const eolBefore = this.doc.eol;
        this.replacingText = true;
        try {
            this.doc.setText(text);
        } finally {
            this.replacingText = false;
        }
        if (!unsaved) this.markSaved();
        this.resetUndoHistory();
        this.onDidChangeContentEmitter.fire();
        if (this.doc.eol !== eolBefore) this.onDidChangeEolEmitter.fire();
    }

    /**
     * Токен шага отвечает на «снимется ли ИМЕННО мой шаг» ({@link IUndoRedoElement.canUndo});
     * при откате/повторе запись переезжает в другой стек новым объектом — токен перечитывается.
     */
    private wrapUndoStep(label: string): IUndoRedoElement {
        let undoToken = this.undoManagerValue.peekUndoStep();
        let redoToken: UndoStepToken | undefined;
        return {
            label,
            resources: this.undoResources,
            canUndo: () => this.undoManagerValue.canUndoStep(undoToken),
            canRedo: () => this.undoManagerValue.canRedoStep(redoToken),
            undo: () => {
                this.undoManagerValue.undo(this.actingView);
                redoToken = this.undoManagerValue.peekRedoStep();
                this.broadcastMarkDirty();
            },
            redo: () => {
                this.undoManagerValue.redo(this.actingView);
                undoToken = this.undoManagerValue.peekUndoStep();
                this.broadcastMarkDirty();
            },
        };
    }

    /** EOL — отдельная от контента ось «изменён» ({@link isModified}). */
    public setEol(eol: EndOfLine, target?: ITextEditTarget): void {
        const previous = this.doc.eol;
        if (previous === eol) return;

        const acting = target ?? this.editTargets.at(0);
        const selections = acting?.cloneSelections() ?? [];
        const version = this.doc.versionId;
        this.doc.setEol(eol);
        this.undoManagerValue.pushUndoElement({
            label: "Change End of Line Sequence",
            versionBefore: version,
            versionAfter: version,
            // Текст шаг не трогает: undo/redo гоняют backwardEdits, а forwardEdits
            // шага EOL не исполняются никогда — мутант массива ненаблюдаем.
            // Stryker disable next-line ArrayDeclaration: эквивалентен — см. выше
            forwardEdits: [],
            backwardEdits: [],
            beforeSelections: selections,
            afterSelections: selections,
            eolBefore: previous,
            eolAfter: eol,
        });
        this.broadcastMarkDirty();
    }

    /**
     * Один undo-шаг. Выделения точно пересчитывает только `target`; остальные вью
     * ремапятся по событию документа. Без `computeCursorState` выделения сдвигаются за правками.
     */
    public applyExternalEdits(
        edits: readonly ITextEdit[],
        label: string,
        target?: ITextEditTarget,
        computeCursorState?: ICursorStateComputer,
    ): void {
        const acting = target ?? this.editTargets.at(0);
        if (acting === undefined) return;
        const element = acting.applyEdits(edits, label, computeCursorState);
        if (element) this.undoManagerValue.pushUndoElement(element);
        this.broadcastMarkDirty();
    }

    /**
     * Шаг не идёт в общий `UndoRedoService`: bulk edit собирает один шаг на весь
     * `workspace.applyEdit`. В {@link UndoManager} документа он ложится как обычно —
     * иначе version-гейт отбросил бы историю документа как устаревшую.
     * `null` — применять нечего (нет вью либо правки ничего не изменили).
     */
    public applyExternalEditsDetached(
        edits: readonly ITextEdit[],
        label: string,
        target?: ITextEditTarget,
    ): IUndoRedoElement | null {
        const acting = target ?? this.editTargets.at(0);
        if (acting === undefined) return null;
        const captured: IUndoRedoElement[] = [];
        this.detachedUndoSteps = captured;
        try {
            const element = acting.applyEdits(edits, label);
            if (element) this.undoManagerValue.pushUndoElement(element);
        } finally {
            this.detachedUndoSteps = null;
        }
        this.broadcastMarkDirty();
        return captured.at(0) ?? null;
    }

    /** `view` — куда восстановить снимок выделений. */
    public undo(view?: IUndoViewBinding): void {
        this.actingView = view ?? null;
        try {
            void this.undoRedoService.undo(this.undoContext);
        } finally {
            this.actingView = null;
        }
    }

    public redo(view?: IUndoViewBinding): void {
        this.actingView = view ?? null;
        try {
            void this.undoRedoService.redo(this.undoContext);
        } finally {
            this.actingView = null;
        }
    }

    /**
     * Фичи языка поднимаются на каждой модели (как `requestRichLanguageFeatures`
     * vscode): расширение с `onLanguage:<id>` встаёт не только для активного редактора.
     */
    private bindDocumentListeners(): void {
        this.languageService.requestLanguageFeatures(this.doc.languageId);
        this.register(
            this.doc.onDidChangeLanguage((change) => {
                this.languageService.requestLanguageFeatures(change.newLanguageId);
                this.onDidChangeLanguageEmitter.fire(change);
            }),
        );
        this.register(
            this.doc.onDidChangeEol(() => {
                if (!this.replacingText) this.onDidChangeEolEmitter.fire();
            }),
        );
        this.register(
            this.doc.onDidChangeContent(() => {
                if (!this.replacingText) this.onDidChangeContentEmitter.fire();
            }),
        );
    }
}
