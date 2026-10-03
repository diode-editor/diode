import * as fs from "node:fs";
import * as path from "node:path";

import { Uri } from "../../../../base/common/uri.ts";
import { clampPositionToDocument } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit, hasOverlappingEdits } from "../../../../editor/common/core/iTextEdit.ts";
import { decodeBuffer, encodeText } from "../../../../editor/common/model/encoding.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    copyInto,
    moveInto,
    moveToPath,
    resolveNonConflictingDest,
} from "../../../../platform/files/node/fileClipboardFs.ts";
import { TrashService, TrashServiceDIToken } from "../../../../platform/files/node/trashService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import {
    UndoRedoService,
    UndoRedoServiceDIToken,
    WORKSPACE_UNDO_CONTEXT,
} from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IBulkEditBuffer, IBulkEditBuffers } from "../common/iBulkEditBuffers.ts";
import { IBulkEditBuffersDIToken } from "../common/iBulkEditBuffers.ts";
import type { BulkEdit, ResourceFileEdit, WorkspaceFileEdit } from "../common/workspaceEdit.ts";
import { isResourceFileEdit } from "../common/workspaceEdit.ts";

interface ReversibleOp {
    undo(): void;
    redo(): void;
    /** См. {@link IUndoRedoElement.canUndo}: отказ одной операции отменяет весь шаг. */
    canUndo?(): boolean;
    canRedo?(): boolean;
    confirmBeforeUndo?: string;
}

/**
 * Все текстовые правки ОДНОГО ресурса внутри edit'а.
 *
 * Координаты правок — исходные координаты ресурса (семантика
 * `vscode.WorkspaceEdit`: правки одного ресурса не сдвигают друг друга, а
 * пересекаться им нельзя), поэтому правки копятся и применяются одной пачкой —
 * сколько бы раз расширение ни дописывало их в edit.
 *
 * Два вида — по тому, КУДА ляжет правка: открытый буфер (`buffer`) или файл на
 * диске. У буфера путь необязателен (безымянный буфер на диске не лежит), у
 * диска он и есть адрес записи.
 */
type ITextSlot =
    | {
          /** Ресурс как `uri.toString()`. */
          readonly resource: string;
          /** Путь на диске; `null` — безымянный буфер (на диске его нет). */
          readonly filePath: string | null;
          readonly buffer: IBulkEditBuffer;
          /** Содержимое буфера ДО правок — по нему клампятся координаты. */
          readonly base: string;
          readonly edits: ITextEdit[];
      }
    | {
          readonly resource: string;
          readonly filePath: string;
          readonly buffer: null;
          /** Содержимое файла ДО правок: база записи и состояние отмены. */
          readonly base: string;
          /** Кодировка дискового представления. */
          readonly encoding: string;
          readonly edits: ITextEdit[];
      };

/** Запись плана в порядке, в котором операцию прислало расширение. */
type PlanEntry =
    | { readonly kind: "file"; readonly edit: WorkspaceFileEdit }
    | { readonly kind: "text"; readonly slot: ITextSlot };

/**
 * Проекция состояния ресурсов по ходу edit'а — «что будет на диске к моменту
 * этой операции». Без неё не провалидировать «создать файл и тут же в него
 * написать»: на диске файла ещё нет.
 */
class ResourceProjection {
    /**
     * Что edit уже сделал с ресурсом: текст созданного/перенесённого файла либо
     * `null` — «ресурса не будет». Пути, которых здесь нет, edit не трогал —
     * про них отвечает диск.
     */
    private readonly state = new Map<string, string | null>();

    public exists(filePath: string): boolean {
        const known = this.state.get(filePath);
        if (known === undefined) return fs.existsSync(filePath);
        return known !== null;
    }

    /** Содержимое файла к этому моменту; `null` — читать нечего (нет файла). */
    public read(filePath: string): { text: string; encoding: string } | null {
        const known = this.state.get(filePath);
        if (known === undefined) return readTextFile(filePath);
        if (known === null) return null;
        return { text: known, encoding: DEFAULT_PROJECTION_ENCODING };
    }

    public createFile(filePath: string, contents: string): void {
        this.state.set(filePath, contents);
    }

    public remove(filePath: string): void {
        this.state.set(filePath, null);
    }

    public rename(from: string, to: string): void {
        const kept = this.read(from);
        this.remove(from);
        // Источник, который не читается текстом (каталог), проецируем пустым:
        // текстовая правка по новому пути всё равно упрётся в файловую систему,
        // а не в проекцию.
        // Stryker disable next-line StringLiteral: содержимое такого источника проекции не известно — любое значение одинаково ненаблюдаемо
        this.state.set(to, kept === null ? "" : kept.text);
    }
}

/**
 * Кодировка файла, созданного самим edit'ом: содержимое пришло строкой от
 * расширения, байтового представления у него не было.
 */
const DEFAULT_PROJECTION_ENCODING = "utf8";

/**
 * Исполняет правки уровня workspace и записывает обратимый шаг в общую историю
 * (`UndoRedoService`). Два входа с разной строгостью:
 *
 * - {@link applyFileEdits} — файловые операции проводника (вставка, создание,
 *   переименование, удаление): сбой одной записи не прерывает остальные, как
 *   при вставке пачки файлов.
 * - {@link applyWorkspaceEdit} — `workspace.applyEdit` расширения: текстовые
 *   правки по ресурсам (открытым и закрытым) плюс файловые операции,
 *   all-or-nothing по валидации и ОДИН шаг отмены на весь edit.
 *
 * Удаление идёт в системную корзину, если она доступна (тогда отменяемо);
 * иначе — безвозвратно (в историю не пишется).
 */
export class WorkspaceEditService {
    public static readonly dependencies = [
        UndoRedoServiceDIToken,
        TrashServiceDIToken,
        IConfigurationServiceDIToken,
        IBulkEditBuffersDIToken,
    ] as const;

    private readonly undoRedo: UndoRedoService;
    private readonly trash: TrashService;
    private readonly config: IConfigurationService;
    /**
     * Доступ к открытым буферам: по какому ресурсу правка обязана идти через
     * буфер, а не через диск, и в какой бакет истории кладётся единственный шаг
     * на весь edit. Даёт полоса групп редакторов (`BulkEditBuffers`); в
     * профилях без редактора — `NULL_BULK_EDIT_BUFFERS`, и весь edit ложится на
     * диск.
     */
    private readonly buffers: IBulkEditBuffers;

    public constructor(
        undoRedo: UndoRedoService,
        trash: TrashService,
        config: IConfigurationService,
        buffers: IBulkEditBuffers,
    ) {
        this.undoRedo = undoRedo;
        this.trash = trash;
        this.config = config;
        this.buffers = buffers;
    }

    /** Пойдёт ли удаление в корзину (настройка разрешает И корзина реально доступна). */
    public willMoveToTrash(): boolean {
        const enabled = this.config.get<boolean>("files.enableTrash", true) ?? true;
        return enabled && this.trash.isAvailable();
    }

    /**
     * Выполняет операции и кладёт обратимый элемент в историю. Возвращает элемент, либо
     * `null`, если ни одна операция не отменяема (например, только безвозвратное удаление).
     */
    public applyFileEdits(edits: readonly ResourceFileEdit[], label: string): IUndoRedoElement | null {
        const ops: ReversibleOp[] = [];
        const resources: string[] = [];

        for (const edit of edits) {
            try {
                this.applyOne(edit, ops, resources);
            } catch {
                // Ошибка по одной записи не прерывает остальные (как в pasteFiles).
            }
        }

        if (ops.length === 0) return null;

        const element = buildUndoElement(label, resources, ops);
        this.undoRedo.pushElement(element, WORKSPACE_UNDO_CONTEXT);
        return element;
    }

    /**
     * Применяет `workspace.applyEdit`: упорядоченный набор текстовых правок и
     * файловых операций. `false` — не применено НИЧЕГО.
     *
     * All-or-nothing: сначала валидируется весь edit (существование ресурсов,
     * read-only буферы, пересечения правок), и лишь потом он применяется.
     * Применённый «наполовину» workspace edit хуже честного отказа — у
     * расширения `applyEdit()` резолвится возвращённым значением, и врать ему
     * об успехе нельзя.
     *
     * Открытый ресурс правится через свой буфер и остаётся «грязным» (как в
     * VS Code), закрытый — записью на диск: буфера у него нет, и «грязным» он
     * быть не может. Весь edit — ОДИН шаг отмены; бакет истории выбирает
     * {@link IBulkEditBuffers.undoContext}.
     */
    public applyWorkspaceEdit(edits: BulkEdit, label: string): boolean {
        // Пустой список — мусорный запрос: вакуумный успех пустого edit'а
        // отвечает сам вызывающий, не доходя до сервиса. Здесь ничего не
        // применено — врать `true` нельзя.
        if (edits.length === 0) return false;
        // Пустой план (все операции оказались законными no-op'ами —
        // `ignoreIfExists` при уже существующей цели) отказом НЕ является:
        // менять нечего, но и не состоялось ничего. Отказ — только `null`.
        const plan = this.planWorkspaceEdit(edits);
        if (plan === null) return false;

        const ops: ReversibleOp[] = [];
        const resources: string[] = [];
        for (const entry of plan) {
            try {
                this.applyPlanEntry(entry, label, ops, resources);
            } catch {
                // Сбой записи после успешной валидации (гонка с внешним
                // процессом, права): откатываем уже применённое и отвечаем
                // отказом — половинчатый edit недопустим.
                for (let i = ops.length - 1; i >= 0; i--) ops[i].undo();
                return false;
            }
        }

        if (ops.length > 0) {
            const touched = plan
                .flatMap((entry) => (entry.kind === "text" ? [entry.slot] : []))
                .filter((slot) => slot.buffer !== null)
                .map((slot) => slot.resource);
            const context = this.buffers.undoContext(touched) ?? WORKSPACE_UNDO_CONTEXT;
            this.undoRedo.pushElement(buildUndoElement(label, resources, ops), context);
        }
        return true;
    }

    /**
     * Валидирует весь edit и раскладывает его в план. `null` — edit отбивается
     * целиком: несуществующий ресурс, read-only буфер, недисковая схема у
     * закрытого ресурса, пересекающиеся правки.
     */
    private planWorkspaceEdit(edits: BulkEdit): PlanEntry[] | null {
        const plan: PlanEntry[] = [];
        const projection = new ResourceProjection();
        /** Ресурс → его единственный слот правок (правки сливаются по ресурсу). */
        const slots = new Map<string, ITextSlot>();

        for (const edit of edits) {
            if (isResourceFileEdit(edit)) {
                // Файловая операция по ресурсу, для которого в ЭТОМ ЖЕ edit'е
                // уже копятся текстовые правки: их база («содержимое до») снята
                // раньше, и перенести её на новый путь нечем — результат считать
                // было бы не по чему. Такого порядка расширения не присылают
                // (сначала файловая операция, потом правки по новому пути),
                // поэтому отбиваем edit, а не применяем невалидированное.
                if (touchesTextSlot(edit, slots)) return null;
                if (!validateFileEdit(edit, projection)) return null;
                if (skipsFileEdit(edit, projection)) continue;
                projectFileEdit(edit, projection);
                plan.push({ kind: "file", edit });
                continue;
            }

            if (edit.edits.length === 0) continue;
            const known = slots.get(edit.resource);
            let slot: ITextSlot;
            if (known === undefined) {
                const opened = this.openTextSlot(edit.resource, projection);
                if (opened === null) return null;
                slot = opened;
                slots.set(edit.resource, slot);
                plan.push({ kind: "text", slot });
            } else {
                slot = known;
            }
            const doc = new TextDocument(slot.base);
            for (const item of edit.edits) {
                const start = clampPositionToDocument(doc, item.range.start);
                const end = clampPositionToDocument(doc, item.range.end);
                slot.edits.push(
                    createTextEdit(createRange(start.line, start.character, end.line, end.character), item.text),
                );
            }
            // Перекрытые правки документ применил бы по уже съеденному тексту —
            // порча содержимого и сломанный undo.
            if (hasOverlappingEdits(slot.edits)) return null;
        }

        return plan;
    }

    /** Слот правок ресурса: открытый буфер либо чтение с диска. `null` — ресурс не правится. */
    private openTextSlot(resource: string, projection: ResourceProjection): ITextSlot | null {
        const uri = Uri.parse(resource);
        const target = this.buffers.get(resource);
        // Ресурс открыт, но правка не состоится (read-only документ) —
        // отказываем честно, не трогая остальные ресурсы edit'а.
        if (target === "read-only") return null;
        if (target !== null) {
            // Путь буфера может и отсутствовать — безымянный буфер на диске не лежит.
            const filePath = uri.scheme === "file" ? uri.fsPath : null;
            return { resource, filePath, buffer: target, base: target.text(), edits: [] };
        }
        // Ресурс не открыт: правим по диску. Недисковые схемы читать нечем —
        // поставщики `IFileSystemProviderRegistry` работают только на чтение,
        // и записать в них правку некуда. Гейт именно по СХЕМЕ, а не по
        // выведенному пути: у чужого uri путь бывает валидным (`probe:/etc/x`),
        // и правка ушла бы в посторонний файл.
        if (uri.scheme !== "file") return null;
        const filePath = uri.fsPath;
        const source = projection.read(filePath);
        if (source === null) return null;
        return { resource, filePath, buffer: null, base: source.text, encoding: source.encoding, edits: [] };
    }

    /** Исполняет одну запись плана, накапливая обратимые шаги. */
    private applyPlanEntry(entry: PlanEntry, label: string, ops: ReversibleOp[], resources: string[]): void {
        if (entry.kind === "file") {
            this.applyOne(entry.edit, ops, resources);
            return;
        }
        const slot = entry.slot;
        if (slot.buffer !== null) {
            if (slot.filePath !== null) resources.push(slot.filePath);
            const step = slot.buffer.applyEdits(slot.edits, label);
            // `null` — правки ничего не изменили: отменять нечего, но и отказом
            // это не является.
            if (step !== null) ops.push(step);
            return;
        }
        const filePath = slot.filePath;
        resources.push(filePath);
        const before = slot.base;
        const after = applyEditsToText(before, slot.edits);
        const encoding = slot.encoding;
        writeTextFile(filePath, after, encoding);
        ops.push({
            // Предусловие отката: на диске ровно то, что мы записали. Файл
            // изменили снаружи — откат затёр бы чужую правку.
            canUndo: () => readTextFile(filePath)?.text === after,
            canRedo: () => readTextFile(filePath)?.text === before,
            undo: () => {
                writeTextFile(filePath, before, encoding);
            },
            redo: () => {
                writeTextFile(filePath, after, encoding);
            },
        });
    }

    private applyOne(edit: ResourceFileEdit, ops: ReversibleOp[], resources: string[]): void {
        // Защита от значения, пришедшего в обход типов (kind типизирован строкой намеренно,
        // чтобы проверка не считалась «всегда истинной» и оставалась осмысленной в рантайме).
        const kind: string = edit.kind;
        if (kind !== "move" && kind !== "rename" && kind !== "copy" && kind !== "delete" && kind !== "create") {
            throw new Error(`Неподдерживаемый вид правки: ${kind}`);
        }

        if (edit.kind === "move") {
            const from = edit.from;
            const toDir = edit.to;
            let current = moveInto(from, toDir);
            resources.push(from, current);
            ops.push({
                undo: () => {
                    current = moveBack(current, from);
                },
                redo: () => {
                    current = moveInto(current, toDir);
                },
            });
        } else if (edit.kind === "rename") {
            // В отличие от move, `to` — точный целевой путь (переименование на месте),
            // а не каталог-назначение. Коллизию отсекает валидация в промпте; у
            // `workspace.applyEdit` её разрешает `overwrite` расширения, и тогда
            // затёртое содержимое надо суметь вернуть при отмене.
            const from = edit.from;
            const to = edit.to;
            // Снимок цели делаем всегда: без `overwrite` валидация сюда с
            // занятой целью не пускает (снимка не будет), а если цель всё же
            // заняли в гонке — отмена вернёт её содержимое, а не потеряет.
            const replaced = keepAside(to);
            moveToPath(from, to);
            let current = to;
            resources.push(from, to);
            ops.push({
                undo: () => {
                    current = moveBack(current, from);
                    replaced?.restore();
                },
                redo: () => {
                    moveToPath(current, to);
                    current = to;
                },
            });
        } else if (edit.kind === "copy") {
            const from = edit.from;
            const toDir = edit.to;
            let created = copyInto(from, toDir);
            resources.push(created);
            ops.push({
                confirmBeforeUndo: `Удалить вставленный «${path.basename(created)}»?`,
                undo: () => {
                    fs.rmSync(created, { recursive: true, force: true });
                },
                redo: () => {
                    created = copyInto(from, toDir);
                },
            });
        } else if (edit.kind === "delete") {
            const from = edit.from;
            resources.push(from);
            if (this.willMoveToTrash()) {
                let entry = this.trash.trash(from);
                ops.push({
                    undo: () => {
                        this.trash.restore(entry);
                    },
                    redo: () => {
                        entry = this.trash.trash(from);
                    },
                });
            } else {
                // Безвозвратно — отменить нельзя, шаг в историю не пишем.
                fs.rmSync(from, { recursive: true, force: true });
            }
        } else {
            const to = edit.to;
            // Явное имя от пользователя: коллизия — жёсткая ошибка (перехватывается
            // per-edit try/catch → чистый no-op, в историю ничего не пишем). Реальная
            // защита от коллизий — валидация в промпте создания.
            const replaced = edit.overwrite === true ? keepAside(to) : null;
            // Stryker disable next-line StringLiteral: текст ошибки проглатывает per-edit try/catch вызывающего — наблюдаем только сам отказ
            if (replaced === null && fs.existsSync(to)) throw new Error(`Уже существует: ${to}`);

            // Самый верхний из создаваемых предков — чтобы undo убрал ровно то, что
            // добавило create (и не тронул уже существовавшие каталоги).
            const createdRoot = shallowestMissingAncestor(to);
            const contents = edit.contents ?? "";
            const doCreate = (): void => {
                fs.mkdirSync(path.dirname(to), { recursive: true });
                if (edit.directory) fs.mkdirSync(to);
                else fs.writeFileSync(to, contents);
            };
            doCreate();
            resources.push(to);
            ops.push({
                undo: () => {
                    fs.rmSync(createdRoot, { recursive: true, force: true });
                    replaced?.restore();
                },
                redo: () => {
                    doCreate();
                },
            });
        }
    }
}

/** Один обратимый шаг истории из набора операций (порядок отката — обратный). */
function buildUndoElement(label: string, resources: readonly string[], ops: readonly ReversibleOp[]): IUndoRedoElement {
    const confirmBeforeUndo = ops.map((o) => o.confirmBeforeUndo).find((m): m is string => m !== undefined);
    return {
        label,
        resources,
        ...(confirmBeforeUndo ? { confirmBeforeUndo } : {}),
        // Отказ ЛЮБОЙ операции отменяет весь шаг: откатить половину (правку
        // одного файла из трёх) хуже, чем не откатить ничего.
        canUndo: () => ops.every((op) => op.canUndo?.() !== false),
        canRedo: () => ops.every((op) => op.canRedo?.() !== false),
        undo() {
            for (let i = ops.length - 1; i >= 0; i--) ops[i].undo();
        },
        redo() {
            for (const op of ops) op.redo();
        },
    };
}

/** Текст после применения пачки правок (координаты — исходные, пересечений нет). */
function applyEditsToText(text: string, edits: readonly ITextEdit[]): string {
    const doc = new TextDocument(text);
    doc.applyEdits(edits);
    return doc.serialize();
}

/** Содержимое файла с диска (с детектом кодировки); `null` — прочитать нечем. */
function readTextFile(filePath: string): { text: string; encoding: string } | null {
    try {
        return decodeBuffer(fs.readFileSync(filePath));
    } catch {
        return null;
    }
}

function writeTextFile(filePath: string, text: string, encoding: string): void {
    fs.writeFileSync(filePath, encodeText(text, encoding));
}

/**
 * Применима ли файловая операция к спроецированному состоянию.
 *
 * Каталог на месте цели отдельной проверки не требует: затереть его нечем —
 * `keepAside` не прочитает его содержимое, и применение отобьётся гардом «уже
 * существует» (а весь edit откатится).
 */
function validateFileEdit(edit: WorkspaceFileEdit, projection: ResourceProjection): boolean {
    if (edit.kind === "delete") {
        return projection.exists(edit.from) || edit.ignoreIfNotExists === true;
    }
    // Переименовывать нечего — источника нет.
    if (edit.kind === "rename" && !projection.exists(edit.from)) return false;
    if (!projection.exists(edit.to)) return true;
    // Занятая цель без явного разрешения — ошибка, из-за которой edit не
    // применяется («the edit cannot be applied successfully»).
    if (edit.ignoreIfExists === true) return true;
    return edit.overwrite === true;
}

/**
 * Операция-no-op: нужное состояние уже достигнуто.
 *
 * Зовётся ПОСЛЕ {@link validateFileEdit}, и это снимает половину проверок:
 * удаление несуществующего доходит сюда только с `ignoreIfNotExists`, а занятая
 * цель — только с `ignoreIfExists` либо `overwrite`. Остаётся развилка между
 * ними: `overwrite` бьёт `ignoreIfExists` (дословно как в vscode API) — с ним
 * операция не пропускается, а затирает цель.
 */
function skipsFileEdit(edit: WorkspaceFileEdit, projection: ResourceProjection): boolean {
    if (edit.kind === "delete") return !projection.exists(edit.from);
    return edit.overwrite !== true && projection.exists(edit.to);
}

/** Проецирует эффект файловой операции на состояние ресурсов. */
function projectFileEdit(edit: WorkspaceFileEdit, projection: ResourceProjection): void {
    if (edit.kind === "create") {
        projection.createFile(edit.to, edit.contents ?? "");
        return;
    }
    // Stryker disable next-line ConditionalExpression: `true` отправит в эту ветку и удаление, а `rename` начинается с `remove(from)` — запись по несуществующему пути никто не читает, наблюдаемой разницы нет
    if (edit.kind === "rename") {
        projection.rename(edit.from, edit.to);
        return;
    }
    projection.remove(edit.from);
}

/** Трогает ли файловая операция ресурс, по которому уже копятся текстовые правки. */
function touchesTextSlot(edit: WorkspaceFileEdit, slots: ReadonlyMap<string, ITextSlot>): boolean {
    const paths = edit.kind === "rename" ? [edit.from, edit.to] : [edit.kind === "delete" ? edit.from : edit.to];
    return paths.some((filePath) => slots.has(Uri.file(filePath).toString()));
}

/**
 * Запоминает содержимое файла, который затрёт `overwrite`: вернуть его на место
 * обязана отмена. Сам файл не трогаем — и запись, и переименование перекрывают
 * цель сами. `null` — затирать нечего (цели нет либо она не файл).
 */
function keepAside(target: string): { restore(): void } | null {
    const kept = readTextFile(target);
    if (kept === null) return null;
    return {
        restore: () => {
            writeTextFile(target, kept.text, kept.encoding);
        },
    };
}

/** Ближайший к корню несуществующий предок `target` (или сам target). */
function shallowestMissingAncestor(target: string): string {
    let current = target;
    let parent = path.dirname(current);
    while (parent !== current && !fs.existsSync(parent)) {
        current = parent;
        parent = path.dirname(current);
    }
    return current;
}

/** Возвращает `src` на `originalPath` (или рядом, если место занято). Возвращает итоговый путь. */
function moveBack(src: string, originalPath: string): string {
    let dest = originalPath;
    if (fs.existsSync(dest)) {
        dest = resolveNonConflictingDest(path.dirname(originalPath), path.basename(originalPath));
    }
    moveToPath(src, dest);
    return dest;
}

export const WorkspaceEditServiceDIToken = token<WorkspaceEditService>("WorkspaceEditService");
