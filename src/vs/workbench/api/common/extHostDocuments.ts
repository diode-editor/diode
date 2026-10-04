import type * as vscode from "vscode";

import {
    DEFAULT_WORD_REGEXP,
    getWordAtText,
    regExpMatchesEmptyString,
} from "../../../editor/common/core/wordHelper.ts";

import { EndOfLine, EventEmitter, Position, Range, Uri } from "./vscodeTypes.ts";
import type { IWireDocumentChangedEvent, IWireDocumentContentChange } from "./wireTypes.ts";

/**
 * Реестр документов на стороне subprocess со СТАБИЛЬНОЙ идентичностью.
 *
 * editorconfig сравнивает документы по ссылке (`activeTextEditor.document ===
 * doc`), поэтому на один ресурс должен приходиться ровно один
 * {@link ExtHostTextDocument}, живущий весь жизненный цикл сессии.
 * Обновления метаданных/текста мутируют существующий объект, а не создают новый.
 *
 * Текст документа — зеркало ядрового: полный снапшот на открытии
 * (`editor.didOpen`) и на flush, дальше — точные правки `editor.didChange`
 * ({@link ExtHostTextDocument.acceptChanges}) с `versionId` модели.
 */

/** Метаданные документа (путь active-editor-change; без текста). */
export interface ExtHostDocumentMeta {
    /** Ресурс документа как `uri.toString()` — идентичность, из неё выводится `fileName`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly isDirty?: boolean;
    /** Кодировка дискового представления (id вида "utf8"/"windows1251"). */
    readonly encoding?: string;
    /** Текущий EOL документа (`vscode.EndOfLine`: 1=LF, 2=CRLF). */
    readonly eol?: EndOfLine;
}

/** Полный снапшот документа (пути will-save и document sync; с текстом). */
export interface ExtHostDocumentSnapshot extends ExtHostDocumentMeta {
    readonly text: string;
    /**
     * Явная версия ядрового документа (путь document sync). LSP требует
     * монотонной версии per-document, поэтому host передаёт `versionId` модели;
     * без неё версия инкрементируется локально (путь will-save).
     */
    readonly version?: number;
}

/** Строка документа (`vscode.TextLine`). */
export interface TextLine {
    readonly lineNumber: number;
    readonly text: string;
    readonly range: Range;
    readonly rangeIncludingLineBreak: Range;
    readonly firstNonWhitespaceCharacterIndex: number;
    readonly isEmptyOrWhitespace: boolean;
}

/**
 * Стабильный объект документа. Идентичность сохраняется между upsert'ами.
 * `implements` — страж против «объявили в d.ts, не реализовали»: расширениям
 * объект уходит как `vscode.TextDocument` без каста.
 */
export class ExtHostTextDocument implements vscode.TextDocument {
    /** Идентичность ресурса — источник правды, как в `vscode.TextDocument.uri`. */
    public readonly uri: Uri;
    /**
     * Закрыт ли документ (последняя вкладка ресурса закрыта — `editor.didClose`).
     * Мутирует {@link DocumentSyncTracker}: закрытие взводит, повторное открытие
     * того же ресурса «воскрешает» тот же объект (идентичность стабильна).
     */
    public isClosed = false;

    /** Отражает кодировку ядрового документа: обновляется из меты/снапшотов. */
    public encoding = "utf8";

    /**
     * Путь ресурса на ФС. По спецификации (`vscode.d.ts`) это shorthand для
     * `uri.fsPath`, «independent of the uri scheme» — то есть производное от uri,
     * а не наоборот.
     */
    public get fileName(): string {
        return this.uri.fsPath;
    }

    /** Безымянный буфер — это схема `untitled:`, а не отдельный флаг. */
    public get isUntitled(): boolean {
        return this.uri.scheme === "untitled";
    }

    /** Отражает EOL ядрового документа: обновляется из меты/снапшотов. */
    public eol: EndOfLine = EndOfLine.LF;

    public languageId = "plaintext";
    public isDirty = false;
    public version = 0;

    /** Строки зеркала (разделитель `\n`) — источник правды: их правят правки. */
    private lineStore: string[] = [""];
    /** Текст целиком — кэш, собирается из строк лениво до следующей мутации. */
    private textCache: string | null = "";

    public constructor(uri: Uri) {
        this.uri = uri;
    }

    /** Обновляет метаданные без смены текста/версии (active-editor-change). */
    public applyMeta(meta: ExtHostDocumentMeta): void {
        if (meta.languageId !== undefined) this.languageId = meta.languageId;
        if (meta.isDirty !== undefined) this.isDirty = meta.isDirty;
        if (meta.encoding !== undefined) this.encoding = meta.encoding;
        if (meta.eol !== undefined) this.eol = meta.eol;
    }

    /**
     * Обновляет текст + метаданные. Версия — явная из снапшота (document sync,
     * `versionId` модели побеждает локальный счётчик) либо инкремент (will-save).
     */
    public applyFull(snapshot: ExtHostDocumentSnapshot): void {
        this.applyMeta(snapshot);
        this.textCache = snapshot.text;
        this.lineStore = snapshot.text.split("\n");
        this.version = snapshot.version ?? this.version + 1;
    }

    /**
     * Применяет правки батча модели по одной — в порядке провода (по убыванию,
     * в координатах до каждой правки; см. `IModelContentChangedEvent` ядра) — и
     * выставляет версию модели. Возвращает правки в виде
     * `TextDocumentContentChangeEvent`: `rangeOffset`/`rangeLength` считаются по
     * строкам ДО каждой правки, как у `mirrorTextModel` эталона. Вставленный
     * текст режется по `\n` — так же, как в модели ядра.
     */
    public acceptChanges(version: number, changes: readonly IWireDocumentContentChange[]): IDocumentContentChange[] {
        const lines = this.lines();
        const result: IDocumentContentChange[] = [];
        for (const { range: wire, text } of changes) {
            const range = this.validateRange(
                new Range(wire.startLine, wire.startCharacter, wire.endLine, wire.endCharacter),
            );
            const rangeOffset = this.offsetAt(range.start);
            const rangeLength = this.offsetAt(range.end) - rangeOffset;
            const prefix = lines[range.start.line].slice(0, range.start.character);
            const suffix = lines[range.end.line].slice(range.end.character);
            const inserted = (prefix + text + suffix).split("\n");
            lines.splice(range.start.line, range.end.line - range.start.line + 1, ...inserted);
            this.textCache = null;
            result.push({ range, rangeOffset, rangeLength, text });
        }
        this.version = version;
        return result;
    }

    public getText(range?: Range): string {
        if (range === undefined) return (this.textCache ??= this.lines().join("\n"));
        // По контракту `vscode.d.ts` диапазон «will be adjusted» — провайдер,
        // посчитавший границу по своей копии текста, не должен получить
        // исключение из-за одного лишнего символа.
        const valid = this.validateRange(range);
        const lines = this.lines();
        if (valid.start.line === valid.end.line) {
            return lines[valid.start.line].slice(valid.start.character, valid.end.character);
        }
        const parts: string[] = [lines[valid.start.line].slice(valid.start.character)];
        for (let n = valid.start.line + 1; n < valid.end.line; n++) {
            parts.push(lines[n]);
        }
        parts.push(lines[valid.end.line].slice(0, valid.end.character));
        return parts.join("\n");
    }

    /**
     * Смещение позиции в тексте документа. Считается по ТОМУ ЖЕ тексту, который
     * отдаёт {@link getText}: строки разделены `\n`, а `\r` у CRLF-документа
     * остаётся частью строки — поэтому «длина строки + 1» точна для обоих EOL.
     */
    public offsetAt(position: Position): number {
        const valid = this.validatePosition(position);
        const lines = this.lines();
        let offset = 0;
        for (let n = 0; n < valid.line; n++) offset += lines[n].length + 1;
        return offset + valid.character;
    }

    /**
     * Позиция по смещению — обратная {@link offsetAt}. Смещение за границами
     * текста прижимается к ним (контракт `vscode.d.ts`: «the offset will be
     * adjusted»); именно так `prettier` строит минимальную правку, сравнивая
     * строки посимвольно.
     */
    public positionAt(offset: number): Position {
        const lines = this.lines();
        let remaining = Math.min(Math.max(0, offset), this.getText().length);
        // Шагаем, пока остаток не влезает в строку. Проверки «не вышли за
        // последнюю строку» тут нет и не нужно: сумма длин строк с
        // разделителями равна длине текста, а смещение к ней прижато — значит
        // на последней строке остаток заведомо не больше её длины.
        let line = 0;
        while (remaining > lines[line].length) {
            remaining -= lines[line].length + 1;
            line++;
        }
        return new Position(line, remaining);
    }

    /**
     * Позиция, прижатая к границам документа (контракт `vscode.d.ts`). Новый
     * объект возвращается ВСЕГДА: на входе бывает не наш `Position`, а любой
     * `{line, character}` из расширения, и отдавать его обратно — отдавать
     * чужой тип.
     */
    public validatePosition(position: Position): Position {
        const lines = this.lines();
        const line = Math.min(Math.max(0, position.line), lines.length - 1);
        return new Position(line, Math.min(Math.max(0, position.character), lines[line].length));
    }

    /** Диапазон, прижатый к границам документа (контракт `vscode.d.ts`). */
    public validateRange(range: Range): Range {
        return new Range(this.validatePosition(range.start), this.validatePosition(range.end));
    }

    /**
     * Слово под позицией (позиция прижимается к документу) — как upstream
     * `ExtHostDocumentData._getWordRangeAtPosition`. Без `regex` — дефолтное
     * определение слова: языковых word-definition у нас нет. Регекс, матчащий
     * пустую строку, отвергается исключением с текстом upstream.
     */
    public getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined {
        const valid = this.validatePosition(position);
        if (regex !== undefined && regExpMatchesEmptyString(regex)) {
            throw new Error(
                `[getWordRangeAtPosition]: ignoring custom regexp '${regex.source}' because it matches the empty string.`,
            );
        }
        const word = getWordAtText(valid.character, regex ?? DEFAULT_WORD_REGEXP, this.lines()[valid.line]);
        return word === null ? undefined : new Range(valid.line, word.start, valid.line, word.end);
    }

    /**
     * Сохранение по просьбе расширения. RPC «сохранить документ по uri» к хосту
     * нет, поэтому честное `false` («не сохранено») вместо молчаливого успеха;
     * закрытый документ — отказ, как upstream.
     */
    public save(): Promise<boolean> {
        if (this.isClosed) return Promise.reject(new Error("Document has been closed"));
        return Promise.resolve(false);
    }

    public get lineCount(): number {
        return this.lines().length;
    }

    public lineAt(lineOrPosition: number | Position): TextLine {
        const lineNumber = typeof lineOrPosition === "number" ? lineOrPosition : lineOrPosition.line;
        const lines = this.lines();
        if (lineNumber < 0 || lineNumber >= lines.length) {
            throw new RangeError(`Illegal line number ${lineNumber} (lineCount=${lines.length})`);
        }
        const text = lines[lineNumber];
        const firstNonWhitespaceCharacterIndex = firstNonWhitespace(text);
        const isLast = lineNumber === lines.length - 1;
        return {
            lineNumber,
            text,
            range: new Range(lineNumber, 0, lineNumber, text.length),
            rangeIncludingLineBreak: isLast
                ? new Range(lineNumber, 0, lineNumber, text.length)
                : new Range(lineNumber, 0, lineNumber + 1, 0),
            firstNonWhitespaceCharacterIndex,
            isEmptyOrWhitespace: firstNonWhitespaceCharacterIndex === text.length,
        };
    }

    private lines(): string[] {
        return this.lineStore;
    }
}

/** Индекс первого не-whitespace символа; длина строки, если вся whitespace. */
function firstNonWhitespace(text: string): number {
    for (let i = 0; i < text.length; i++) {
        if (!/\s/.test(text[i])) return i;
    }
    return text.length;
}

/**
 * Реестр `Map<uri.toString(), ExtHostTextDocument>` со стабильной идентичностью.
 * Ключ — ресурс, а не путь: путь у не-file схем неоднозначен, а `Map` всё равно
 * сравнивает только строки.
 */
export class DocumentRegistry {
    private readonly documents = new Map<string, ExtHostTextDocument>();

    public get(uri: Uri): ExtHostTextDocument | undefined {
        return this.documents.get(uri.toString());
    }

    /** Лениво создаёт стабильный документ (нужен ДО прихода снапшота). */
    public getOrCreate(uri: Uri): ExtHostTextDocument {
        const key = uri.toString();
        let doc = this.documents.get(key);
        if (doc === undefined) {
            doc = new ExtHostTextDocument(uri);
            this.documents.set(key, doc);
        }
        return doc;
    }

    public upsertMeta(meta: ExtHostDocumentMeta): ExtHostTextDocument {
        const doc = this.getOrCreate(Uri.parse(meta.uri));
        doc.applyMeta(meta);
        return doc;
    }

    public upsertFull(snapshot: ExtHostDocumentSnapshot): ExtHostTextDocument {
        const doc = this.getOrCreate(Uri.parse(snapshot.uri));
        doc.applyFull(snapshot);
        return doc;
    }

    /** Все известные документы (задел под `workspace.textDocuments`, WP3). */
    public all(): ExtHostTextDocument[] {
        return [...this.documents.values()];
    }
}

/** Одна правка контента (`vscode.TextDocumentContentChangeEvent`). */
export interface IDocumentContentChange {
    readonly range: Range;
    readonly rangeOffset: number;
    readonly rangeLength: number;
    readonly text: string;
}

/** Событие правки (`vscode.TextDocumentChangeEvent`). */
export interface IDocumentChangeEvent {
    readonly document: ExtHostTextDocument;
    readonly contentChanges: readonly IDocumentContentChange[];
    readonly reason: undefined;
}

/** Позиция конца текста (для full-range change-события document sync). */
function endOfText(text: string): Position {
    const lines = text.split("\n");
    const last = lines.length - 1;
    return new Position(last, lines[last].length);
}

/**
 * ЕДИНСТВЕННАЯ точка входа текста в реестр: document sync (`editor.didOpen` —
 * {@link DocumentSyncTracker.open}, `editor.didChange` — правками
 * {@link DocumentSyncTracker.change}). Запросы (will-save,
 * `languages.provide*`) текста не везут — документ им даёт
 * {@link DocumentSyncTracker.resolve}.
 *
 * Инвариант: любой потребитель onDidOpen/onDidChange (стоковый
 * vscode-languageclient, который транслирует их в LSP didOpen/didChange) видит
 * КАЖДЫЙ переход текста реестра как событие, а full-range у didChange посчитан
 * от предыдущего текста реестра. Запись в реестр мимо трекера ломает оба
 * контракта, и оба ломались по-настоящему: `languages.provide*` писали текст
 * запроса через `registry.upsertFull` напрямую — (1) провайдер звался до
 * didOpen, клиент слал серверу запрос по неизвестному документу («Unexpected
 * resource» у typescript-language-server), (2) обогнавший коалесированный
 * didChange запрос затирал oldText, следующий didChange нёс диапазон от УЖЕ
 * нового текста, tsserver получал правку за пределами своей копии и падал
 * (`Cannot read properties of undefined (reading 'charCount')`).
 */
export class DocumentSyncTracker {
    /** Ресурсы, о которых уже фаерился didOpen (один раз на ресурс — как в VS Code). */
    private readonly opened = new Set<string>();
    public readonly onDidOpenEmitter = new EventEmitter<ExtHostTextDocument>();
    public readonly onDidChangeEmitter = new EventEmitter<IDocumentChangeEvent>();
    public readonly onDidCloseEmitter = new EventEmitter<ExtHostTextDocument>();

    /**
     * @param warn куда сообщить о рассинхроне (по умолчанию stderr субпроцесса —
     *   хост зеркалит его в лог расширений)
     */
    public constructor(
        private readonly registry: DocumentRegistry,
        private readonly warn: (message: string) => void = (message) => {
            console.warn(`[ext-host] ${message}`);
        },
    ) {}

    /**
     * Согласует снапшот с реестром: новый ресурс → didOpen; изменившийся текст →
     * didChange одной full-range правкой (валидно и для Full, и для Incremental
     * sync сервера); тот же текст → тихое обновление меты (без churn версии).
     */
    public open(snapshot: ExtHostDocumentSnapshot): ExtHostTextDocument {
        const prev = this.registry.get(Uri.parse(snapshot.uri));
        if (prev === undefined || !this.opened.has(snapshot.uri)) {
            const doc = this.registry.upsertFull(snapshot);
            // Воскрешение после didClose: тот же объект, isClosed снят.
            doc.isClosed = false;
            this.opened.add(snapshot.uri);
            this.onDidOpenEmitter.fire(doc);
            return doc;
        }
        const oldText = prev.getText();
        if (oldText === snapshot.text) {
            prev.applyMeta(snapshot);
            return prev;
        }
        // Диапазон — ДО upsert'а: реестр мутирует стабильный объект документа.
        const fullRange = new Range(new Position(0, 0), endOfText(oldText));
        const doc = this.registry.upsertFull(snapshot);
        this.onDidChangeEmitter.fire({
            document: doc,
            contentChanges: [{ range: fullRange, rangeOffset: 0, rangeLength: oldText.length, text: snapshot.text }],
            reason: undefined,
        });
        return doc;
    }

    /**
     * Правки модели (`editor.didChange`): применяются к зеркалу открытого
     * документа и уходят расширениям настоящими `contentChanges`. По
     * неоткрытому документу правки отбрасываются с предупреждением —
     * применённые к чужому тексту, они испортили бы зеркало (хост шлёт правки
     * только открытым, так что это нарушенный инвариант, а не штатный путь).
     */
    public change(event: IWireDocumentChangedEvent): ExtHostTextDocument | null {
        if (!this.opened.has(event.uri)) {
            this.warn(`document sync: changes for a document that is not open: ${event.uri}`);
            return null;
        }
        // Открытый документ всегда есть в реестре — `getOrCreate` его только находит.
        const doc = this.registry.getOrCreate(Uri.parse(event.uri));
        const contentChanges = doc.acceptChanges(event.version, event.changes);
        // `applyMeta` сам пропускает отсутствующие поля.
        doc.applyMeta({ uri: event.uri, isDirty: event.isDirty });
        this.onDidChangeEmitter.fire({ document: doc, contentChanges, reason: undefined });
        return doc;
    }

    /**
     * Документ запроса провайдера или will-save: запросы текста не везут —
     * провайдер читает зеркало. `null` (ответить пусто), если документ не
     * открыт или запрос устарел (ядро уже ушло дальше — его ответ оно всё равно
     * отбросит). Версия запроса впереди зеркала — нарушенный инвариант порядка
     * (правки и запросы едут одним каналом): предупреждение и тоже `null`.
     * `languageId` запроса доводит язык документа (смену языка модели).
     */
    public resolve(uri: string, version: number | undefined, languageId?: unknown): ExtHostTextDocument | null {
        if (!this.opened.has(uri)) return null;
        // Открытый документ всегда есть в реестре — `getOrCreate` его только находит.
        const doc = this.registry.getOrCreate(Uri.parse(uri));
        if (doc.version !== version) {
            // Stryker disable next-line ConditionalExpression,EqualityOperator: эквивалентны — сравнение с `undefined` всегда ложно, а равные версии отсеяны условием выше
            if (version !== undefined && version > doc.version) {
                this.warn(
                    `document sync: request for ${uri} v${String(version)} is ahead of the mirror v${String(doc.version)}`,
                );
            }
            return null;
        }
        if (typeof languageId === "string") doc.applyMeta({ uri, languageId });
        return doc;
    }

    /**
     * Закрытие документа (`editor.didClose`): сброс didOpen-дедупа (следующее
     * открытие того же ресурса снова фаерит didOpen — сервер получает свежий
     * didOpen после didClose, как требует LSP) + `isClosed` + событие. Документ
     * остаётся в реестре — расширения вправе держать ссылку на закрытый документ.
     */
    public close(uri: Uri): ExtHostTextDocument | null {
        const doc = this.registry.get(uri);
        if (doc === undefined || !this.opened.has(uri.toString())) return null;
        this.opened.delete(uri.toString());
        doc.isClosed = true;
        this.onDidCloseEmitter.fire(doc);
        return doc;
    }
}
