import { Emitter } from "../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import type { EndOfLine } from "../../../editor/common/core/endOfLine.ts";
import type { ISelection } from "../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../editor/common/languages/iLanguageService.ts";
import type { IDocumentLanguageChange } from "../../../editor/common/model/iDocumentLanguageChange.ts";
import type { IUndoElement } from "../../../editor/common/model/iUndoElement.ts";
import { TextDocument } from "../../../editor/common/model/textDocument.ts";
import type { IUndoViewBinding, UndoStepToken } from "../../../editor/common/model/undoManager.ts";
import { UndoManager } from "../../../editor/common/model/undoManager.ts";
import type { IUndoRedoElement } from "../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";

/** Источник непрозрачных ключей истории отмены (см. {@link BaseTextEditorModel.undoContext}). */
let nextUndoContextId = 1;

/**
 * Шов модели к одной редактирующей поверхности (view). Правки, которые модель
 * применяет сама (save-участник, смена EOL, программные батчи), идут через
 * view-state **действующей** вью — там живут выделения и inverse-edits для undo.
 * Прикрепляет каждый парный `EditorComponent` в своём конструкторе; целей может
 * быть несколько (один документ в нескольких группах): действующую передаёт
 * вызывающий, `markDirty` вещается всем.
 */
export interface ITextEditTarget {
    cloneSelections(): ISelection[];
    applyEdits(edits: readonly ITextEdit[], label: string): IUndoElement | undefined;
    markDirty(): void;
}

/**
 * Текстовый буфер без view и без файловых осей (аналог upstream
 * `BaseTextEditorModel`): документ, язык, EOL, история отмены, правки через
 * прикреплённые вью и события буфера. Общий для файла с диска
 * (`TextFileModel`) и для синтетики, чьё содержимое даёт владелец
 * (`SyntheticTextModel`: Output, виртуальные документы, снимки диффа).
 */
export abstract class BaseTextEditorModel extends Disposable {
    /**
     * Документ модели — один на всю её жизнь: перечитка и смена содержимого
     * владельцем меняют текст в нём ({@link replaceText}), а не подменяют объект.
     * Поэтому view, токены и синхронизация с расширениями видят перечитку
     * обычной правкой.
     */
    protected readonly doc: TextDocument;
    /**
     * Идёт замена содержимого целиком ({@link replaceText}): ретрансляция
     * событий документа ждёт, пока модель согласует «сохранённую» версию, —
     * иначе подписчик увидел бы свежий текст с признаком несохранённых правок.
     */
    private replacingText = false;
    private readonly onDidChangeLanguageEmitter = this.register(new Emitter<IDocumentLanguageChange>());
    private readonly onDidChangeEolEmitter = this.register(new Emitter<void>());
    private readonly onDidChangeContentEmitter = this.register(new Emitter<void>());
    /** Идентичность ресурса модели (схему задаёт наследник). */
    protected uriValue: Uri;
    protected savedVersionId = 0;
    protected savedEol: EndOfLine;
    protected readonly languageService: ILanguageService;
    private readonly undoRedoService: UndoRedoService;
    /**
     * Редактирующие поверхности прикреплённых вью (см. {@link ITextEditTarget}).
     * Порядок — порядок прикрепления; первый служит целью по умолчанию для
     * программных путей без действующей вью (save-участник).
     */
    private editTargets: ITextEditTarget[] = [];
    /**
     * Движок undo документа — история одна на документ, сколько бы вью его ни
     * показывало. Замена содержимого целиком историю забывает
     * ({@link resetUndoHistory}); роутинг шагов в {@link UndoRedoService} модель
     * ставит сама в {@link createUndoManager}.
     */
    private readonly undoManagerValue: UndoManager;
    /**
     * Вью, инициировавшая текущий undo/redo (ей восстанавливается снимок
     * выделений). Живёт только на время синхронного окна вызова: обёртка-элемент
     * в `UndoRedoService` исполняется до первого await внутри `undo(context)`.
     */
    private actingView: IUndoViewBinding | null = null;
    /**
     * Куда уходят обёртки шагов, пока идёт {@link applyExternalEditsDetached}:
     * `null` — штатный режим (шаг сразу в общий бакет), массив — шаг забирает
     * вызывающий. Живёт только на время синхронного окна применения.
     */
    private detachedUndoSteps: IUndoRedoElement[] | null = null;

    /**
     * Контекст-бакет истории отмены этого **документа** — непрозрачный
     * идентификатор, выданный при создании модели. Намеренно НЕ путь и НЕ uri:
     * ключ обязан быть стабильным на всём времени жизни. Путь бакетом быть не
     * может — на нём ломались два бага: все безымянные буферы сходились в общий
     * бакет `"untitled"`, а `saveAs` менял ключ и осиротлял уже накопленную
     * историю. Модель одна на документ (реестр в `EditorService`), поэтому ключ
     * per-модель и есть ключ per-документ — сплит-вью делят историю через неё.
     *
     * Ключ бакета и `resources` обёртки-элемента — разные вещи: первый адресует
     * историю, второй перечисляет затронутые пути и у безымянного буфера пуст.
     */
    // Уникальность держится и при счёте вниз (0, -1, …) — мутант ненаблюдаем.
    // Stryker disable next-line UpdateOperator: эквивалентен — см. выше
    public readonly undoContext = `editor-${nextUndoContextId++}`;

    public readonly onDidChangeContent = this.onDidChangeContentEmitter.event;

    /**
     * Событие смены языка документа (setLanguage, Save As с другим расширением).
     * Подписка живёт на модели.
     */
    public readonly onDidChangeLanguage = this.onDidChangeLanguageEmitter.event;

    /**
     * Событие смены EOL документа (командой, undo/redo — любым путём через
     * doc.setEol, перечиткой с другим EOL). Подписка живёт на модели.
     */
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

        // Очищаем историю отмены этого редактора при закрытии вкладки.
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

    /** Открытый документ — один на всю жизнь модели (см. {@link doc}). */
    public get document(): TextDocument {
        return this.doc;
    }

    /** Language id открытого документа (`plaintext`, если язык не определён). */
    public get languageId(): string {
        return this.doc.languageId;
    }

    /**
     * Меняет язык документа вручную (Change Language Mode). Токенизатор
     * пересаживает парный компонент через подписку на onDidChangeLanguage.
     */
    public setLanguage(languageId: string): void {
        this.doc.setLanguage(languageId);
    }

    /** Идентичность ресурса буфера. */
    public get uri(): Uri {
        return this.uriValue;
    }

    public getText(): string {
        return this.doc.getText();
    }

    /**
     * Прикрепляет редактирующую поверхность (см. {@link ITextEditTarget}).
     * Вызывает каждый парный `EditorComponent` в своём конструкторе; возвращённый
     * disposable снимает цель, когда вью закрывается раньше модели (сплиты).
     */
    public attachEditTarget(target: ITextEditTarget): IDisposable {
        this.editTargets.push(target);
        return {
            dispose: () => {
                const i = this.editTargets.indexOf(target);
                if (i >= 0) this.editTargets.splice(i, 1);
            },
        };
    }

    /** Общий движок undo документа (для `EditorElement` прикреплённых вью). */
    public get undoManager(): UndoManager {
        return this.undoManagerValue;
    }

    /** Перерисовка всех прикреплённых вью (dirty-маркер, EOL — видимое меняется везде). */
    protected broadcastMarkDirty(): void {
        for (const target of [...this.editTargets]) target.markDirty();
    }

    /**
     * Пути, которых касается шаг истории (`IUndoRedoElement.resources`): у
     * буфера без файла на диске — пусто.
     */
    protected get undoResources(): string[] {
        return [];
    }

    /**
     * Движок undo документа, подключённый к общей истории: каждый шаг
     * регистрирует обёртку в `UndoRedoService` под контекстом модели. Обёртка —
     * токен порядка: её undo/redo делегируют в {@link UndoManager} (LIFO 1:1,
     * поэтому стеки идут в ногу) и передают действующую вью ({@link actingView}),
     * взведённую публичными {@link undo}/{@link redo}.
     */
    private createUndoManager(): UndoManager {
        const undoManager = new UndoManager(this.doc);
        undoManager.onDidPush = (element) => {
            const wrapper = this.wrapUndoStep(element.label);
            // Шаг забирает вызывающий (bulk edit) — в общий бакет он НЕ идёт:
            // иначе на один workspace edit пришлось бы столько же Ctrl+Z,
            // сколько документов он тронул.
            if (this.detachedUndoSteps !== null) {
                this.detachedUndoSteps.push(wrapper);
                return;
            }
            this.undoRedoService.pushElement(wrapper, this.undoContext);
        };
        return undoManager;
    }

    /**
     * Забывает историю отмены: содержимое заменено целиком, и накопленные шаги
     * адресуют текст, которого больше нет (их version-гейт всё равно отбросил
     * бы каждый молча).
     */
    private resetUndoHistory(): void {
        this.undoRedoService.clear(this.undoContext);
        this.undoManagerValue.clear();
    }

    /** Текущая версия — «сохранённая»: буфер чистый. */
    protected markSaved(): void {
        this.savedVersionId = this.doc.versionId;
        this.savedEol = this.doc.eol;
    }

    /**
     * Заменяет содержимое целиком в том же документе (перечитка с диска, смена
     * содержимого владельцем). Буфер после этого чистый и без истории; события
     * контента и EOL доходят до подписчиков модели уже после того, как она
     * согласовала «сохранённую» версию.
     */
    protected replaceText(text: string): void {
        const eolBefore = this.doc.eol;
        this.replacingText = true;
        try {
            this.doc.setText(text);
        } finally {
            this.replacingText = false;
        }
        this.markSaved();
        this.resetUndoHistory();
        this.onDidChangeContentEmitter.fire();
        if (this.doc.eol !== eolBefore) this.onDidChangeEolEmitter.fire();
    }

    /**
     * Обёртка шага документа для общей истории: токен порядка, чьи undo/redo
     * делегируют в {@link UndoManager}. Токен шага снимается здесь же — им
     * обёртка отвечает на вопрос «снимется ли ИМЕННО мой шаг» ({@link
     * IUndoRedoElement.canUndo}); при откате/повторе запись переезжает в
     * противоположный стек новым объектом, поэтому токен каждый раз
     * перечитывается.
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

    /**
     * Changes the document's end-of-line sequence. The change is undoable and
     * marks the buffer dirty (EOL is tracked as a separate axis from content —
     * see {@link isModified}). `target` — действующая вью (её выделения попадают
     * в снимок undo-шага); программные пути (save-участник) её не передают —
     * берётся первая прикреплённая.
     */
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
     * Applies a programmatic batch of edits as a single undoable operation.
     *
     * A seam for edits that don't originate from user input — editor commands
     * (trim-trailing-whitespace, insert-final-newline) and save participants.
     * Pushes an undo element (if anything changed) and repaints. Document
     * dirtiness follows automatically from the version bump. `target` —
     * действующая вью: её view-state применяет правки (и пересчитывает свои
     * выделения точно); остальные вью ремапятся по событию документа.
     */
    public applyExternalEdits(edits: readonly ITextEdit[], label: string, target?: ITextEditTarget): void {
        const acting = target ?? this.editTargets.at(0);
        if (acting === undefined) return;
        const element = acting.applyEdits(edits, label);
        if (element) this.undoManagerValue.pushUndoElement(element);
        this.broadcastMarkDirty();
    }

    /**
     * То же, что {@link applyExternalEdits}, но шаг истории НЕ попадает в общий
     * `UndoRedoService` — его забирает вызывающий. Так bulk edit собирает ОДИН
     * шаг на весь `workspace.applyEdit`: правки по нескольким документам и
     * файловые операции отменяются вместе, одним Ctrl+Z.
     *
     * В {@link UndoManager} самого документа шаг ложится как обычно — без него
     * version-гейт отбрасывал бы собственную историю документа как устаревшую.
     *
     * `null` — применять нечего (нет прикреплённой вью либо правки ничего не
     * изменили): вызывающий обязан различать это от успеха.
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

    /** Откат шага истории; `view` — действующая вью (восстановление выделений в неё). */
    public undo(view?: IUndoViewBinding): void {
        this.actingView = view ?? null;
        try {
            // Обёртка-элемент читает actingView синхронно: UndoRedoService зовёт
            // element.undo() до первого await внутри undo(context).
            void this.undoRedoService.undo(this.undoContext);
        } finally {
            this.actingView = null;
        }
    }

    /** Повтор откаченного шага; `view` — как в {@link undo}. */
    public redo(view?: IUndoViewBinding): void {
        this.actingView = view ?? null;
        try {
            void this.undoRedoService.redo(this.undoContext);
        } finally {
            this.actingView = null;
        }
    }

    /**
     * Подписывается на события документа (один раз — документ живёт с моделью):
     * смена языка, смена EOL и правки контента ретранслируются подписчикам
     * модели; замену содержимого целиком модель объявляет сама
     * ({@link replaceText}).
     *
     * Язык документа — повод поднять его фичи (`requestLanguageFeatures`, у
     * vscode — `requestRichLanguageFeatures`): и у нового документа, и при
     * смене языка (Change Language Mode, Save As с другим расширением). Так
     * расширение с `onLanguage:<id>` встаёт для любой модели, а не только для
     * активного редактора.
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
