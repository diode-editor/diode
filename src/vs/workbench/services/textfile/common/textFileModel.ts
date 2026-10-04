import * as fs from "node:fs";
import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { mark } from "../../../../base/common/performance.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import {
    decodeBuffer,
    DEFAULT_ENCODING,
    encodeText,
    getEncodingInfo,
} from "../../../../editor/common/model/encoding.ts";
import type { IDocumentLanguageChange } from "../../../../editor/common/model/iDocumentLanguageChange.ts";
import type { IUndoElement } from "../../../../editor/common/model/iUndoElement.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import type { IUndoViewBinding, UndoStepToken } from "../../../../editor/common/model/undoManager.ts";
import { UndoManager } from "../../../../editor/common/model/undoManager.ts";
import {
    etag,
    FileOperationResult,
    type IFileService,
    type IFileStat,
    isFileOperationError,
} from "../../../../platform/files/common/files.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import type { TextFileSaveParticipant } from "./textFileSaveParticipant.ts";

/**
 * Итог сохранения. `conflict` — файл на диске изменился внешним процессом с
 * момента открытия/последней записи, и запись отменена (чтобы не затереть
 * параллельные правки); повторить с `{ overwrite: true }`.
 */
export type SaveOutcome = "saved" | "conflict" | "no-file";

/** Снимок метаданных файла на диске для детекта внешних изменений (mtime + размер). */
interface IDiskStat {
    mtimeMs: number;
    size: number;
}

/** etag снимка в форме файлового сервиса (см. {@link etag}): гард записи. */
function diskEtag(stat: IDiskStat): string {
    return etag({ mtime: stat.mtimeMs, size: stat.size });
}

/** Источник непрозрачных ключей истории отмены (см. {@link TextFileModel.undoContext}). */
let nextUndoContextId = 1;

/**
 * Ресурс свежесозданной модели: безымянный буфер без номера. Номер назначает группа
 * ({@link TextFileModel.setUntitled}) — она владеет счётчиком; до этого модель ещё
 * никто не видит.
 */
const UNTITLED_PLACEHOLDER_URI = Uri.from({ scheme: "untitled", path: "Untitled" });

/**
 * Шов модели к одной редактирующей поверхности (view). Правки, которые модель
 * применяет сама (save-участник, смена EOL, программные батчи), идут через
 * view-state **действующей** вью — там живут выделения и inverse-edits для undo.
 * Прикрепляет каждый парный `EditorComponent` в своём конструкторе; целей может
 * быть несколько (один документ в нескольких группах): действующую передаёт
 * вызывающий, `markDirty` вещается всем.
 */
export interface ITextFileEditTarget {
    cloneSelections(): ISelection[];
    applyEdits(edits: readonly ITextEdit[], label: string): IUndoElement | undefined;
    markDirty(): void;
}

/**
 * Per-file модель текстового файла без view (аналог `ITextFileEditorModel` VS Code):
 * владеет {@link TextDocument}, dirty-статусом, осями encoding/EOL/language, записью
 * на диск (save/saveAs + save-участник) и слежением за файлом на диске (авто-перечитка
 * чистого буфера / флаг конфликта у «грязного»). Не singleton-сервис: экземпляр на
 * файл, создаёт владелец (`EditorService`) вместе с парным
 * `EditorComponent`.
 */
export class TextFileModel extends Disposable {
    /**
     * Документ модели — один на всю её жизнь: перечитка с диска и смена
     * содержимого владельцем меняют текст в нём ({@link replaceText}), а не
     * подменяют объект. Поэтому view, токены и синхронизация с расширениями
     * видят перечитку обычной правкой.
     */
    private readonly doc: TextDocument;
    /**
     * Идёт замена содержимого целиком ({@link replaceText}): ретрансляция
     * событий документа ждёт, пока модель согласует «сохранённую» версию, —
     * иначе подписчик увидел бы свежий текст с признаком несохранённых правок.
     */
    private replacingText = false;
    private readonly onDidChangeLanguageEmitter = this.register(new Emitter<IDocumentLanguageChange>());
    private readonly onDidChangeEolEmitter = this.register(new Emitter<void>());
    /**
     * Кодировка байтового представления на диске (id из SUPPORTED_ENCODINGS).
     * В отличие от EOL это состояние модели, а не документа: документ видит
     * только строки, а кодировка применяется на дисковой границе (read/write).
     * Не undoable и не входит в isModified — Reopen заменяет документ целиком,
     * Save with Encoding сохраняет сразу (как в VS Code).
     */
    private encodingValue: string = DEFAULT_ENCODING;
    private readonly onDidChangeEncodingEmitter = this.register(new Emitter<void>());
    private readonly onDidChangeContentEmitter = this.register(new Emitter<void>());
    /**
     * Идентичность ресурса этой модели — первичное состояние, из которого выводится
     * всё остальное (путь, имя, признак безымянности). Не `null`: у свежей модели
     * это `untitled:`-буфер, а не «модель без ресурса», поэтому ветку «пути нет»
     * задаёт схема, а не отсутствие значения.
     */
    private uriValue: Uri = UNTITLED_PLACEHOLDER_URI;
    private savedVersionId = 0;
    private savedEol: EndOfLine;
    /**
     * Метаданные файла на момент последнего чтения/записи. Сверяя их с текущим
     * stat, мы отличаем внешнее изменение файла от собственной записи и от
     * «файл не трогали». `null` — файла не было на диске при открытии.
     */
    private diskStat: IDiskStat | null = null;
    private diskConflictValue = false;
    private readonly onDidChangeDiskStateEmitter = this.register(new Emitter<void>());
    private fileWatch: IDisposable | null = null;
    private readonly languageService: ILanguageService;
    private readonly undoRedoService: UndoRedoService;
    /**
     * Редактирующие поверхности прикреплённых вью (см. {@link ITextFileEditTarget}).
     * Порядок — порядок прикрепления; первый служит целью по умолчанию для
     * программных путей без действующей вью (save-участник).
     */
    private editTargets: ITextFileEditTarget[] = [];
    /**
     * Движок undo документа — история одна на документ, сколько бы вью его ни
     * показывало. Перечитка содержимого целиком историю забывает
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

    public get isModified(): boolean {
        return this.doc.versionId !== this.savedVersionId || this.doc.eol !== this.savedEol;
    }

    public get eol(): EndOfLine {
        return this.doc.eol;
    }

    /** Кодировка, в которой документ читается с диска и пишется на диск. */
    public get encoding(): string {
        return this.encodingValue;
    }

    /** Открытый документ — один на всю жизнь модели (см. {@link doc}). */
    public get document(): TextDocument {
        return this.doc;
    }

    /**
     * Меняет кодировку, в которой документ будет записан на диск. Неизвестные
     * id игнорируются (пикеры оперируют только элементами SUPPORTED_ENCODINGS).
     * Содержимое буфера не трогает — перечитывание с диска делает
     * {@link reopenWithEncoding}.
     */
    public setEncoding(encoding: string): void {
        if (getEncodingInfo(encoding) === undefined) return;
        this.applyEncoding(encoding);
    }

    private applyEncoding(encoding: string): void {
        if (this.encodingValue === encoding) return;
        this.encodingValue = encoding;
        this.onDidChangeEncodingEmitter.fire();
    }

    private readonly onDidSaveDocumentEmitter = this.register(new Emitter<void>());

    /**
     * Событие «документ записан на диск» (save/saveAs). Первым подписан
     * владелец-сервис (перепривязка реестра моделей), дальше — вкладки: сохранение меняет вид вкладки (гаснет маркер
     * изменённости, после saveAs меняется имя) — у каждой из N вкладок
     * документа.
     */
    public readonly onDidSaveDocument = this.onDidSaveDocumentEmitter.event;

    private fireSaved(): void {
        this.onDidSaveDocumentEmitter.fire();
    }

    /**
     * Наблюдатель за файлами (инъектируется группой перед openFile). Когда задан,
     * модель следит за открытым файлом и реагирует на внешние изменения
     * (авто-перечитка чистого буфера, флаг конфликта для «грязного»). По
     * умолчанию `null` — без live-watch (юнит-тесты, если фейк не подставлен).
     */
    public fileWatcher: IFileWatcher | null = null;

    /**
     * Пайплайн save-участников, общий для всех моделей владельца
     * (`EditorService`); модель прогоняет его перед записью — и в `save`, и в
     * `saveAs`. Не задан ⇒ участников нет.
     */
    public saveParticipant: TextFileSaveParticipant | null = null;

    /**
     * `true`, если файл изменился на диске внешним процессом, а в буфере есть
     * несохранённые правки (авто-перечитать нельзя — затрём пользователя). При
     * следующем сохранении это приведёт к диалогу подтверждения перезаписи.
     */
    public get hasDiskConflict(): boolean {
        return this.diskConflictValue;
    }

    /**
     * Событие смены «дискового» состояния модели: файл перечитан с диска
     * (чистый буфер) либо взведён/снят флаг конфликта. Подписка живёт на
     * модели и переживает пересоздание документа в openFile.
     */
    public readonly onDidChangeDiskState = this.onDidChangeDiskStateEmitter.event;

    public readonly onDidChangeContent = this.onDidChangeContentEmitter.event;

    /** Language id открытого документа (`plaintext`, если язык не определён). */
    public get languageId(): string {
        return this.doc.languageId;
    }

    /**
     * Меняет язык документа вручную (закладка под будущий language picker,
     * аналог `editor.action.changeLanguage` из VS Code). Токенизатор
     * пересаживает парный компонент через подписку на onDidChangeLanguage.
     */
    public setLanguage(languageId: string): void {
        this.doc.setLanguage(languageId);
    }

    /**
     * Событие смены языка документа. Подписка живёт на модели, а не на
     * конкретном документе — переживает пересоздание документа в openFile.
     */
    public readonly onDidChangeLanguage = this.onDidChangeLanguageEmitter.event;

    /**
     * Событие смены EOL документа (командой, undo/redo — любым путём через
     * doc.setEol). Подписка живёт на модели, а не на конкретном
     * документе — переживает пересоздание документа в openFile.
     */
    public readonly onDidChangeEol = this.onDidChangeEolEmitter.event;

    /**
     * Событие смены кодировки (setEncoding, reopenWithEncoding или детект при
     * открытии другого файла). Подписка живёт на модели.
     */
    public readonly onDidChangeEncoding = this.onDidChangeEncodingEmitter.event;

    /** Идентичность ресурса: `file:` — файл на диске, `untitled:` — безымянный буфер. */
    public get uri(): Uri {
        return this.uriValue;
    }

    /**
     * Путь ресурса на диске или `null`, если его там нет (безымянный буфер).
     *
     * Гейт по схеме, а не по «`fsPath` непустой»: `fsPath` у не-file схемы не бросает,
     * а отдаёт путь как есть (`untitled:Untitled-1` → `"Untitled-1"`), и такой «путь»
     * ушёл бы в `node:fs` как относительный.
     */
    private get filePath(): string | null {
        return this.uriValue.scheme === "file" ? this.uriValue.fsPath : null;
    }

    public get fileName(): string | null {
        const filePath = this.filePath;
        return filePath === null ? null : path.basename(filePath);
    }

    public get absoluteFilePath(): string | null {
        return this.filePath;
    }

    /**
     * @param files Запись на диск (save / saveAs) — через файловый сервис:
     * атомарно, с гардом по etag и очередью записи на ресурс. Чтение пока
     * синхронное, мимо сервиса (docs/TODO/FileService.md, PR 5).
     */
    public constructor(
        languageService: ILanguageService,
        undoRedoService: UndoRedoService,
        private readonly files: IFileService,
    ) {
        super();

        this.languageService = languageService;
        this.undoRedoService = undoRedoService;

        this.doc = new TextDocument("");
        this.savedEol = this.doc.eol;
        this.bindDocumentListeners();
        this.undoManagerValue = this.createUndoManager();

        this.register({
            dispose: () => {
                this.fileWatch?.dispose();
            },
        });
        // Очищаем историю отмены этого редактора при закрытии вкладки.
        this.register({
            dispose: () => {
                this.undoRedoService.clear(this.undoContext);
            },
        });
    }

    /**
     * Прикрепляет редактирующую поверхность (см. {@link ITextFileEditTarget}).
     * Вызывает каждый парный `EditorComponent` в своём конструкторе; возвращённый
     * disposable снимает цель, когда вью закрывается раньше модели (сплиты).
     */
    public attachEditTarget(target: ITextFileEditTarget): IDisposable {
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
    private broadcastMarkDirty(): void {
        for (const target of [...this.editTargets]) target.markDirty();
    }

    /**
     * Пересоздаёт движок undo под текущий документ и подключает его к общей
     * истории: каждый шаг регистрирует обёртку в `UndoRedoService` под контекстом
     * модели. Обёртка — токен порядка: её undo/redo делегируют в {@link UndoManager}
     * (LIFO 1:1, поэтому стеки идут в ногу) и передают действующую вью
     * ({@link actingView}), взведённую публичными {@link undo}/{@link redo}.
     *
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

    /**
     * Заменяет содержимое целиком в том же документе (перечитка с диска, смена
     * содержимого владельцем). Буфер после этого чистый и без истории; события
     * контента и EOL доходят до подписчиков модели уже после того, как она
     * согласовала «сохранённую» версию.
     */
    private replaceText(text: string): void {
        const eolBefore = this.doc.eol;
        this.replacingText = true;
        try {
            this.doc.setText(text);
        } finally {
            this.replacingText = false;
        }
        this.savedVersionId = this.doc.versionId;
        this.savedEol = this.doc.eol;
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
        const filePath = this.filePath;
        let undoToken = this.undoManagerValue.peekUndoStep();
        let redoToken: UndoStepToken | undefined;
        return {
            label,
            resources: filePath === null ? [] : [filePath],
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
     * Присваивает буферу номер безымянного (`untitled:Untitled-N`). Номерами владеет
     * группа: счётчик общий на группу, а вызывать это надо до того, как редактор
     * попадёт в список вкладок и станет кому-то виден.
     */
    public setUntitled(untitledNumber: number): void {
        this.uriValue = Uri.from({ scheme: "untitled", path: `Untitled-${untitledNumber}` });
    }

    /**
     * Открывает файл с диска. Принимает уже поднятый `file:`-uri: подъём (и `path.resolve`
     * относительных путей из CLI/дерева) делает группа — единственная точка, где строка
     * становится ресурсом. `Uri.file` относительный путь НЕ резолвит, поэтому резолвить
     * после подъёма было бы поздно.
     */
    public openFile(uri: Uri): void {
        // Гейт по схеме: `fsPath` у не-file uri не бросает, а отдаёт путь как
        // есть — без гейта `git:`-ресурс молча показал бы рабочее дерево и
        // повесил watcher на чужой путь. Не-file буферы — `openSynthetic`.
        if (uri.scheme !== "file") {
            throw new Error(`TextFileModel.openFile: ожидается file:-uri, получен ${uri.scheme}:`);
        }
        this.uriValue = uri;
        const filePath = uri.fsPath;
        this.loadDocumentFromDisk(filePath);
        this.startWatchingFile(filePath);
    }

    /**
     * Открывает буфер, которого нет на диске: содержимое даёт владелец, а не
     * файловая система (Output-канал — `output:<channel>`, как в VS Code). Ни
     * чтения, ни watcher'а, ни `diskStat` — значит `save()` вернёт `"no-file"`,
     * а внешних изменений у такого ресурса не бывает по построению.
     *
     * Язык задаётся явно: выводить его из «пути» вида `output:extensions` нечем.
     */
    public openSynthetic(uri: Uri, languageId: string): void {
        this.uriValue = uri;
        this.doc.setLanguage(languageId);
    }

    /**
     * Дописывает текст в конец буфера от имени **владельца** документа.
     *
     * Идёт мимо `EditorViewState`, в отличие от {@link applyExternalEdits}, и это
     * намеренно: там стоит read-only-гард, а владелец писать обязан. Это ровно
     * разделение VS Code — `OutputChannelModel` пишет в `ITextModel`, а `readOnly`
     * живёт на виджете редактора и правки владельца не касается.
     *
     * API специально **только append**: правка в самом конце документа не сдвигает
     * ни выделения, ни фолды выше неё, поэтому пропуск ремапа во view-state
     * безопасен. Произвольные правки так проводить нельзя — для них
     * {@link applyExternalEdits}.
     */
    public appendOwnedContent(text: string): void {
        if (text.length === 0) return;
        const line = this.doc.lineCount - 1;
        const column = this.doc.getLineLength(line);
        this.doc.applyEdits([createTextEdit(createRange(line, column, line, column), text)]);
        // Правка владельца не должна пачкать буфер: у синтетического ресурса нет
        // диска, и «несохранённых изменений» у него быть не может.
        this.savedVersionId = this.doc.versionId;
        this.broadcastMarkDirty();
    }

    /** Заменяет содержимое буфера целиком (смена активного Output-канала). */
    public replaceOwnedContent(text: string): void {
        this.replaceText(text);
    }

    /**
     * Читает файл с диска в документ модели ({@link replaceText}: история
     * отмены сбрасывается, view ремапит каретку и скролл как при любой правке).
     * Общий путь для
     * {@link openFile}, {@link revertToDisk} и {@link reopenWithEncoding}. Обновляет
     * снимок `diskStat` и снимает флаг конфликта. Кодировка: `explicitEncoding`
     * побеждает BOM-сниф; без него — сниф BOM, иначе utf-8 (revert пере-детектит,
     * как reload в VS Code).
     */
    private loadDocumentFromDisk(filePath: string, explicitEncoding?: string): void {
        const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
        // Вехи лестницы старта (docs/TODO/OpenPerformance.md): без трассы — no-op.
        mark("textfile:read", { bytes: buffer.length });
        const { text: content, encoding } = decodeBuffer(buffer, explicitEncoding);
        mark("textfile:decoded", { chars: content.length });
        this.applyEncoding(encoding);
        this.diskStat = this.readDiskStat(filePath);
        this.diskConflictValue = false;
        this.replaceText(content);
        mark("textfile:document-built", { lines: this.doc.lineCount });
        // Язык — после текста: у перечитки того же файла он прежний (no-op), а
        // у первого открытия смена языка пересаживает токенизатор уже готовым
        // вью — на документ с текстом, а не на пустой.
        this.doc.setLanguage(this.resolveLanguageId(filePath));
    }

    public async save(options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        if (this.filePath === null) return "no-file";
        // Защита от затирания параллельных правок: если файл на диске изменился
        // внешним процессом с момента открытия/последней записи — не пишем, а
        // сообщаем о конфликте. Повторный вызов с overwrite: true форсит запись.
        if (options?.overwrite !== true && this.hasExternalChange(this.filePath)) {
            this.setDiskConflict(true);
            return "conflict";
        }
        const participation = this.saveParticipant?.participate(this) ?? null;
        if (participation !== null) await participation;
        let written: IFileStat;
        try {
            written = await this.files.writeFile(this.uriValue, encodeText(this.doc.serialize(), this.encodingValue), {
                atomic: true,
                // Тот же гард, что выше, но в момент записи: пока работали
                // участники, файл мог измениться снаружи.
                etag: options?.overwrite === true || this.diskStat === null ? undefined : diskEtag(this.diskStat),
            });
        } catch (e) {
            if (!isFileOperationError(e, FileOperationResult.ModifiedSince)) throw e;
            this.setDiskConflict(true);
            return "conflict";
        }
        this.diskStat = { mtimeMs: written.mtime, size: written.size };
        this.savedVersionId = this.doc.versionId;
        this.savedEol = this.doc.eol;
        this.setDiskConflict(false);
        this.fireSaved();
        return "saved";
    }

    /**
     * Меняет кодировку и сразу сохраняет («Save with Encoding»). Для буфера без
     * файла на диске возвращает "no-file" — вызывающий уводит в Save As
     * (кодировка при этом уже выставлена).
     */
    public async saveWithEncoding(encoding: string, options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        this.setEncoding(encoding);
        return this.save(options);
    }

    /**
     * Перечитывает файл с диска, отбрасывая несохранённые правки (аналог
     * `Revert File` в VS Code). Используется авто-перечиткой чистого буфера при
     * внешнем изменении и вручную. Возвращает `false`, если файла нет.
     */
    public revertToDisk(): boolean {
        if (this.filePath === null) return false;
        this.loadDocumentFromDisk(this.filePath);
        return true;
    }

    /**
     * Перечитывает файл с диска в указанной кодировке («Reopen with Encoding»),
     * отбрасывая несохранённые правки — подтверждение у «грязного» буфера
     * спрашивает вызывающий. Возвращает `false` для буфера без файла на диске.
     */
    public reopenWithEncoding(encoding: string): boolean {
        if (this.filePath === null) return false;
        this.loadDocumentFromDisk(this.filePath, encoding);
        return true;
    }

    /**
     * Changes the document's end-of-line sequence. The change is undoable and
     * marks the buffer dirty (EOL is tracked as a separate axis from content —
     * see {@link isModified}). `target` — действующая вью (её выделения попадают
     * в снимок undo-шага); программные пути (save-участник) её не передают —
     * берётся первая прикреплённая.
     */
    public setEol(eol: EndOfLine, target?: ITextFileEditTarget): void {
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
     * Writes the document to a new path and re-points the model to it.
     *
     * Unlike {@link openFile}, the document/view-state/undo-history/cursor are
     * preserved — the undo bucket is keyed by {@link undoContext}, which is tied to
     * the editor rather than to its path, so re-pointing does not strand the history
     * accumulated before the save. The language is re-resolved for the new extension;
     * the bound language listener re-tokenizes and repaints automatically. Firing
     * `onDidSave` lets the group controller rename the tab and clear the dirty
     * marker.
     */
    public async saveAs(newPath: string): Promise<void> {
        // Смена идентичности на месте: у безымянного буфера это переход untitled: → file:.
        this.uriValue = Uri.file(path.resolve(newPath));
        const participation = this.saveParticipant?.participate(this) ?? null;
        if (participation !== null) await participation;
        const written = await this.files.writeFile(
            this.uriValue,
            encodeText(this.doc.serialize(), this.encodingValue),
            { atomic: true },
        );
        this.diskStat = { mtimeMs: written.mtime, size: written.size };
        this.doc.setLanguage(this.resolveLanguageId(newPath));
        this.savedVersionId = this.doc.versionId;
        this.savedEol = this.doc.eol;
        this.setDiskConflict(false);
        this.startWatchingFile(newPath);
        this.fireSaved();
    }

    /** Читает stat файла (mtime + размер) или `null`, если файла нет/недоступен. */
    private readDiskStat(filePath: string): IDiskStat | null {
        try {
            const stat = fs.statSync(filePath);
            return { mtimeMs: stat.mtimeMs, size: stat.size };
        } catch {
            return null;
        }
    }

    /**
     * Изменился ли файл на диске внешним процессом с момента последней
     * синхронизации (`diskStat`). Сверяем mtime и размер — этого достаточно,
     * чтобы поймать чужую запись и не спутать её с собственной. Отсутствие файла
     * (удалён/недоступен) не считаем конфликтом: `save` просто пересоздаст его.
     */
    private hasExternalChange(filePath: string): boolean {
        if (this.diskStat === null) return false;
        const current = this.readDiskStat(filePath);
        if (current === null) return false;
        return current.mtimeMs !== this.diskStat.mtimeMs || current.size !== this.diskStat.size;
    }

    /** (Пере)подписывается на внешние изменения текущего файла через `fileWatcher`. */
    private startWatchingFile(filePath: string): void {
        this.fileWatch?.dispose();
        this.fileWatch =
            this.fileWatcher?.watchFile(filePath, () => {
                this.handleExternalFileChange(filePath);
            }) ?? null;
    }

    /**
     * Реакция на сигнал watcher'а. Собственную запись отсеиваем сверкой stat
     * (после save `diskStat` уже обновлён). Реальное внешнее изменение: чистый
     * буфер — тихо перечитываем с диска (как VS Code); «грязный» — взводим флаг
     * конфликта, чтобы предупредить при сохранении. Удаление/недоступность
     * игнорируем (частый промежуточный шаг атомарной записи чужим редактором).
     */
    private handleExternalFileChange(filePath: string): void {
        if (!this.hasExternalChange(filePath)) return;
        if (this.isModified) {
            this.setDiskConflict(true);
        } else {
            this.revertToDisk();
            this.fireDiskStateChange();
        }
    }

    private setDiskConflict(value: boolean): void {
        if (this.diskConflictValue === value) return;
        this.diskConflictValue = value;
        this.fireDiskStateChange();
    }

    private fireDiskStateChange(): void {
        this.onDidChangeDiskStateEmitter.fire();
    }

    public getText(): string {
        return this.doc.getText();
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
    public applyExternalEdits(edits: readonly ITextEdit[], label: string, target?: ITextFileEditTarget): void {
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
        target?: ITextFileEditTarget,
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
    public readonly undoContext = `editor-${nextUndoContextId++}`;

    /**
     * Language detection is delegated to the {@link ILanguageService}
     * (implemented by `LanguageRegistry` from the Extensions layer).
     */
    private resolveLanguageId(filePath: string): string {
        return this.languageService.getLanguageIdForResource(filePath) ?? "plaintext";
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
