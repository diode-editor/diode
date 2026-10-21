import * as path from "node:path";

import { Uri } from "../../../../base/common/uri.ts";
import { clampPositionToDocument } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit, hasOverlappingEdits } from "../../../../editor/common/core/iTextEdit.ts";
import { decodeBufferByBOM, encodeText, type IDecodedText } from "../../../../editor/common/model/encoding.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    FileOperationResult,
    type IFileService,
    IFileServiceDIToken,
    isFileOperationError,
} from "../../../../platform/files/common/files.ts";
import {
    type ITrashEntry,
    type ITrashService,
    ITrashServiceDIToken,
} from "../../../../platform/files/common/iTrashService.ts";
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
    undo(): void | Promise<void>;
    redo(): void | Promise<void>;
    /** См. {@link IUndoRedoElement.canUndo}: отказ одной операции отменяет весь шаг. */
    canUndo?(): boolean | Promise<boolean>;
    canRedo?(): boolean | Promise<boolean>;
    confirmBeforeUndo?: string;
}

/**
 * Правки ОДНОГО ресурса в его исходных координатах (семантика `vscode.WorkspaceEdit`: не сдвигают
 * друг друга и не пересекаются), поэтому копятся и применяются одной пачкой.
 */
type ITextSlot =
    | {
          /** `uri.toString()`. */
          readonly resource: string;
          /** `null` — безымянный буфер. */
          readonly filePath: string | null;
          readonly buffer: IBulkEditBuffer;
          /** До правок — по нему клампятся координаты. */
          readonly base: string;
          readonly edits: ITextEdit[];
      }
    | {
          readonly resource: string;
          readonly filePath: string;
          readonly buffer: null;
          readonly base: string;
          readonly encoding: string;
          /**
           * Файл появился в этом же edit'е: перед повтором шага его ещё нет — его вернёт файловая
           * операция шага, идущая раньше правки.
           */
          readonly bornInEdit: boolean;
          readonly edits: ITextEdit[];
      };

/** В порядке, в котором операции прислало расширение. */
type PlanEntry =
    | { readonly kind: "file"; readonly edit: WorkspaceFileEdit }
    | { readonly kind: "text"; readonly slot: ITextSlot };

/** «Что будет на диске к моменту операции»: без неё не провалидировать «создать файл и тут же в него написать». */
class ResourceProjection {
    public constructor(private readonly files: IFileService) {}

    /** `null` — «ресурса не будет»; путей, которых здесь нет, edit не трогал — про них отвечает диск. */
    private readonly state = new Map<string, string | null>();

    public exists(filePath: string): Promise<boolean> {
        const known = this.state.get(filePath);
        if (known === undefined) return this.files.exists(Uri.file(filePath));
        return Promise.resolve(known !== null);
    }

    /** `null` — файла нет. */
    public read(filePath: string): Promise<{ text: string; encoding: string } | null> {
        const known = this.state.get(filePath);
        if (known === undefined) return readTextFile(this.files, filePath);
        if (known === null) return Promise.resolve(null);
        return Promise.resolve({ text: known, encoding: DEFAULT_PROJECTION_ENCODING });
    }

    public knows(filePath: string): boolean {
        return this.state.has(filePath);
    }

    public createFile(filePath: string, contents: string): void {
        this.state.set(filePath, contents);
    }

    public remove(filePath: string): void {
        this.state.set(filePath, null);
    }

    public async rename(from: string, to: string): Promise<void> {
        const kept = await this.read(from);
        this.remove(from);
        // Каталог проецируем пустым: правка по новому пути всё равно упрётся в ФС, а не в проекцию.
        // Stryker disable next-line StringLiteral: содержимое такого источника проекции не известно — любое значение одинаково ненаблюдаемо
        this.state.set(to, kept === null ? "" : kept.text);
    }
}

/** Файл создан самим edit'ом: содержимое пришло строкой, байтового представления не было. */
const DEFAULT_PROJECTION_ENCODING = "utf8";

/**
 * {@link applyFileEdits} (проводник): сбой одной записи не прерывает остальные. {@link applyWorkspaceEdit}:
 * all-or-nothing и ОДИН шаг отмены на весь edit. Удаление — в корзину, если она доступна (тогда
 * отменяемо), иначе безвозвратно и мимо истории.
 */
export class WorkspaceEditService {
    public static readonly dependencies = [
        UndoRedoServiceDIToken,
        ITrashServiceDIToken,
        IConfigurationServiceDIToken,
        IBulkEditBuffersDIToken,
        IFileServiceDIToken,
    ] as const;

    private readonly undoRedo: UndoRedoService;
    private readonly trash: ITrashService;
    private readonly config: IConfigurationService;
    private readonly buffers: IBulkEditBuffers;

    public constructor(
        undoRedo: UndoRedoService,
        trash: ITrashService,
        config: IConfigurationService,
        buffers: IBulkEditBuffers,
        private readonly files: IFileService,
    ) {
        this.undoRedo = undoRedo;
        this.trash = trash;
        this.config = config;
        this.buffers = buffers;
    }

    public willMoveToTrash(): boolean {
        const enabled = this.config.get("files.enableTrash");
        return enabled && this.trash.isAvailable();
    }

    /** `null` — ни одна операция не отменяема (например, только безвозвратное удаление). */
    public async applyFileEdits(edits: readonly ResourceFileEdit[], label: string): Promise<IUndoRedoElement | null> {
        const ops: ReversibleOp[] = [];
        const resources: string[] = [];

        for (const edit of edits) {
            try {
                await this.applyOne(edit, ops, resources);
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
     * `false` — не применено НИЧЕГО: весь edit валидируется до применения, ведь у расширения `applyEdit()`
     * резолвится этим значением. Открытый ресурс правится через буфер и остаётся грязным (как в VS Code),
     * закрытый — записью на диск.
     */
    public async applyWorkspaceEdit(
        edits: BulkEdit,
        label: string,
        options?: { respectAutoSaveConfig?: boolean },
    ): Promise<boolean> {
        // Пустой список: вакуумный успех отвечает вызывающий, здесь не применено ничего.
        if (edits.length === 0) return false;
        // Пустой план (все операции — законные no-op) отказом НЕ является; отказ — только `null`.
        const plan = await this.planWorkspaceEdit(edits);
        if (plan === null) return false;

        const ops: ReversibleOp[] = [];
        const resources: string[] = [];
        for (const entry of plan) {
            try {
                await this.applyPlanEntry(entry, label, ops, resources);
            } catch {
                // Сбой записи после валидации (гонка, права): откатываем применённое — половинчатый edit недопустим.
                for (let i = ops.length - 1; i >= 0; i--) await ops[i].undo();
                return false;
            }
        }

        if (ops.length > 0) {
            const touched = plan
                .flatMap((entry) => (entry.kind === "text" ? [entry.slot] : []))
                .filter((slot) => slot.buffer !== null)
                .map((slot) => slot.resource);
            this.undoRedo.pushWorkspaceElement(
                buildUndoElement(label, resources, ops),
                this.buffers.undoParticipants(touched),
            );
        }
        if (options?.respectAutoSaveConfig === true) await this.saveRefactoring(plan);
        return true;
    }

    /**
     * Эталон — `BulkEditService._saveAll`: без сохранения буферов «Move to a new file» оставил бы новый
     * файл на диске, а исходник — только в буфере.
     */
    private async saveRefactoring(plan: readonly PlanEntry[]): Promise<void> {
        if (!this.config.get("files.refactoring.autoSave")) return;
        if (touchedResources(plan).size <= 1) return;
        const buffers = plan.flatMap((entry) =>
            entry.kind === "text" && entry.slot.buffer !== null ? [entry.slot.buffer] : [],
        );
        await Promise.allSettled(buffers.map((buffer) => buffer.save()));
    }

    /** `null` — edit отбивается целиком. */
    private async planWorkspaceEdit(edits: BulkEdit): Promise<PlanEntry[] | null> {
        const plan: PlanEntry[] = [];
        const projection = new ResourceProjection(this.files);
        const slots = new Map<string, ITextSlot>();

        for (const edit of edits) {
            if (isResourceFileEdit(edit)) {
                // База текстовых правок ресурса уже снята, перенести её на новый путь нечем. Расширения
                // присылают обратный порядок (операция, потом правки), поэтому отбиваем edit.
                if (touchesTextSlot(edit, slots)) return null;
                if (!(await validateFileEdit(edit, projection))) return null;
                if (await skipsFileEdit(edit, projection)) continue;
                await projectFileEdit(edit, projection);
                plan.push({ kind: "file", edit });
                continue;
            }

            if (edit.edits.length === 0) continue;
            const known = slots.get(edit.resource);
            let slot: ITextSlot;
            if (known === undefined) {
                const opened = await this.openTextSlot(edit.resource, projection);
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

    private async openTextSlot(resource: string, projection: ResourceProjection): Promise<ITextSlot | null> {
        const uri = Uri.parse(resource);
        const target = this.buffers.get(resource);
        if (target === "read-only") return null;
        if (target !== null) {
            const filePath = uri.scheme === "file" ? uri.fsPath : null;
            return { resource, filePath, buffer: target, base: target.text(), edits: [] };
        }
        // Гейт по СХЕМЕ, а не по выведенному пути: у чужого uri путь бывает валидным (`probe:/etc/x`),
        // и правка ушла бы в посторонний файл.
        if (uri.scheme !== "file") return null;
        const filePath = uri.fsPath;
        const source = await projection.read(filePath);
        if (source === null) return null;
        return {
            resource,
            filePath,
            buffer: null,
            base: source.text,
            encoding: source.encoding,
            bornInEdit: projection.knows(filePath),
            edits: [],
        };
    }

    private async applyPlanEntry(
        entry: PlanEntry,
        label: string,
        ops: ReversibleOp[],
        resources: string[],
    ): Promise<void> {
        if (entry.kind === "file") {
            await this.applyOne(entry.edit, ops, resources);
            return;
        }
        const slot = entry.slot;
        if (slot.buffer !== null) {
            if (slot.filePath !== null) resources.push(slot.filePath);
            const step = slot.buffer.applyEdits(slot.edits, label);
            // `null` — правки ничего не изменили; это не отказ.
            if (step !== null) ops.push(step);
            return;
        }
        const filePath = slot.filePath;
        resources.push(filePath);
        const before = slot.base;
        const after = applyEditsToText(before, slot.edits);
        const encoding = slot.encoding;
        const bornInEdit = slot.bornInEdit;
        const files = this.files;
        await writeTextFile(files, filePath, after, encoding);
        ops.push({
            // Файл изменили снаружи — откат затёр бы чужую правку.
            canUndo: async () => (await readTextFile(files, filePath))?.text === after,
            canRedo: async () => {
                const current = await readTextFile(files, filePath);
                return current === null ? bornInEdit : current.text === before;
            },
            undo: () => writeTextFile(files, filePath, before, encoding),
            redo: () => writeTextFile(files, filePath, after, encoding),
        });
    }

    private async applyOne(edit: ResourceFileEdit, ops: ReversibleOp[], resources: string[]): Promise<void> {
        const files = this.files;
        // Защита от значения, пришедшего в обход типов (kind типизирован строкой намеренно,
        // чтобы проверка не считалась «всегда истинной» и оставалась осмысленной в рантайме).
        const kind: string = edit.kind;
        if (kind !== "move" && kind !== "rename" && kind !== "copy" && kind !== "delete" && kind !== "create") {
            throw new Error(`Неподдерживаемый вид правки: ${kind}`);
        }

        if (edit.kind === "move") {
            const from = edit.from;
            const toDir = edit.to;
            let current = await moveInto(files, from, toDir);
            resources.push(from, current);
            ops.push({
                undo: async () => {
                    current = await moveBack(files, current, from);
                },
                redo: async () => {
                    current = await moveInto(files, current, toDir);
                },
            });
        } else if (edit.kind === "rename") {
            // `to` — точный путь, а не каталог. Коллизию отсекает промпт, у `workspace.applyEdit` её
            // разрешает `overwrite` — затёртое содержимое надо вернуть при отмене.
            const from = edit.from;
            const to = edit.to;
            // Снимок цели всегда: если цель заняли в гонке, отмена вернёт её содержимое.
            const replaced = await keepAside(files, to);
            await moveToPath(files, from, to);
            let current = to;
            resources.push(from, to);
            ops.push({
                undo: async () => {
                    current = await moveBack(files, current, from);
                    await replaced?.restore();
                },
                redo: async () => {
                    await moveToPath(files, current, to);
                    current = to;
                },
            });
        } else if (edit.kind === "copy") {
            const from = edit.from;
            const toDir = edit.to;
            let created = await copyInto(files, from, toDir);
            resources.push(created);
            ops.push({
                confirmBeforeUndo: `Удалить вставленный «${path.basename(created)}»?`,
                undo: () => removeIfExists(files, created),
                redo: async () => {
                    created = await copyInto(files, from, toDir);
                },
            });
        } else if (edit.kind === "delete") {
            const from = edit.from;
            resources.push(from);
            if (this.willMoveToTrash()) {
                // Корзина — мимо файлового сервиса: о вкладках удалённого
                // сообщаем сами (безвозвратное удаление сообщает сервис).
                const trash = async (): Promise<ITrashEntry> => {
                    const trashed = await this.trash.trash(from);
                    this.buffers.didDelete(Uri.file(from).toString());
                    return trashed;
                };
                let entry = await trash();
                ops.push({
                    undo: async () => {
                        await this.trash.restore(entry);
                    },
                    redo: async () => {
                        entry = await trash();
                    },
                });
            } else {
                // Безвозвратно — отменить нельзя, шаг в историю не пишем.
                await removeIfExists(files, from);
            }
        } else {
            const to = edit.to;
            // Коллизия при явном имени — ошибка (per-edit try/catch → no-op); защита — валидация в промпте.
            const replaced = edit.overwrite === true ? await keepAside(files, to) : null;
            // Stryker disable next-line StringLiteral: текст ошибки проглатывает per-edit try/catch вызывающего — наблюдаем только сам отказ
            if (replaced === null && (await files.exists(Uri.file(to)))) throw new Error(`Уже существует: ${to}`);

            // Самый верхний из создаваемых предков — чтобы undo убрал ровно то, что
            // добавило create (и не тронул уже существовавшие каталоги).
            const createdRoot = await shallowestMissingAncestor(files, to);
            const contents = edit.contents ?? "";
            const doCreate = async (): Promise<void> => {
                await files.createFolder(Uri.file(path.dirname(to)));
                if (edit.directory) await files.createFolder(Uri.file(to));
                else await files.writeFile(Uri.file(to), new TextEncoder().encode(contents));
            };
            await doCreate();
            resources.push(to);
            ops.push({
                undo: async () => {
                    await removeIfExists(files, createdRoot);
                    await replaced?.restore();
                },
                redo: doCreate,
            });
        }
    }
}

/**
 * Отказ любого — отказ всех. Синхронен, пока синхронны все ответы: Ctrl+Z по правке только открытых
 * буферов откатывает их до возврата. Промис — только если кто-то спрашивает диск.
 */
function allAllow(answers: readonly (boolean | Promise<boolean> | undefined)[]): boolean | Promise<boolean> {
    if (answers.some((answer) => answer instanceof Promise)) {
        return Promise.all(answers.map((answer) => Promise.resolve(answer))).then((all) =>
            all.every((can) => can !== false),
        );
    }
    return answers.every((can) => can !== false);
}

/** Откат — в обратном порядке. */
function buildUndoElement(label: string, resources: readonly string[], ops: readonly ReversibleOp[]): IUndoRedoElement {
    const confirmBeforeUndo = ops.map((o) => o.confirmBeforeUndo).find((m): m is string => m !== undefined);
    return {
        label,
        resources,
        ...(confirmBeforeUndo ? { confirmBeforeUndo } : {}),
        // Отказ ЛЮБОЙ операции отменяет весь шаг: откатить половину (правку
        // одного файла из трёх) хуже, чем не откатить ничего.
        canUndo: () => allAllow(ops.map((op) => op.canUndo?.())),
        canRedo: () => allAllow(ops.map((op) => op.canRedo?.())),
        async undo() {
            for (let i = ops.length - 1; i >= 0; i--) await ops[i].undo();
        },
        async redo() {
            for (const op of ops) await op.redo();
        },
    };
}

/** Координаты — исходные, пересечений нет. */
function applyEditsToText(text: string, edits: readonly ITextEdit[]): string {
    const doc = new TextDocument(text);
    doc.applyEdits(edits);
    return doc.serialize();
}

async function readTextFile(files: IFileService, filePath: string): Promise<IDecodedText | null> {
    try {
        return decodeBufferByBOM(Buffer.from((await files.readFile(Uri.file(filePath))).value));
    } catch {
        return null;
    }
}

async function writeTextFile(files: IFileService, filePath: string, text: string, encoding: string): Promise<void> {
    await files.writeFile(Uri.file(filePath), await encodeText(text, encoding));
}

async function removeIfExists(files: IFileService, target: string): Promise<void> {
    try {
        await files.del(Uri.file(target), { recursive: true });
    } catch (e) {
        if (!isFileOperationError(e, FileOperationResult.NotFound)) throw e;
    }
}

/**
 * Каталог на месте цели отдельной проверки не требует: `keepAside` его не прочитает, и применение
 * отобьётся гардом «уже существует».
 */
async function validateFileEdit(edit: WorkspaceFileEdit, projection: ResourceProjection): Promise<boolean> {
    if (edit.kind === "delete") {
        return (await projection.exists(edit.from)) || edit.ignoreIfNotExists === true;
    }
    if (edit.kind === "rename" && !(await projection.exists(edit.from))) return false;
    if (!(await projection.exists(edit.to))) return true;
    // Занятая цель без явного разрешения — edit не применяется.
    if (edit.ignoreIfExists === true) return true;
    return edit.overwrite === true;
}

/**
 * Зовётся ПОСЛЕ {@link validateFileEdit}, поэтому различает лишь `overwrite` и `ignoreIfExists`:
 * `overwrite` бьёт `ignoreIfExists` (как в vscode API) — с ним операция затирает цель.
 */
async function skipsFileEdit(edit: WorkspaceFileEdit, projection: ResourceProjection): Promise<boolean> {
    if (edit.kind === "delete") return !(await projection.exists(edit.from));
    return edit.overwrite !== true && (await projection.exists(edit.to));
}

async function projectFileEdit(edit: WorkspaceFileEdit, projection: ResourceProjection): Promise<void> {
    if (edit.kind === "create") {
        projection.createFile(edit.to, edit.contents ?? "");
        return;
    }
    // Stryker disable next-line ConditionalExpression: `true` отправит в эту ветку и удаление, а `rename` начинается с `remove(from)` — запись по несуществующему пути никто не читает, наблюдаемой разницы нет
    if (edit.kind === "rename") {
        await projection.rename(edit.from, edit.to);
        return;
    }
    projection.remove(edit.from);
}

function touchedResources(plan: readonly PlanEntry[]): Set<string> {
    const touched = new Set<string>();
    for (const entry of plan) {
        if (entry.kind === "text") {
            touched.add(entry.slot.resource);
            continue;
        }
        for (const filePath of fileEditPaths(entry.edit)) touched.add(Uri.file(filePath).toString());
    }
    return touched;
}

function fileEditPaths(edit: WorkspaceFileEdit): string[] {
    return edit.kind === "rename" ? [edit.from, edit.to] : [edit.kind === "delete" ? edit.from : edit.to];
}

function touchesTextSlot(edit: WorkspaceFileEdit, slots: ReadonlyMap<string, ITextSlot>): boolean {
    return fileEditPaths(edit).some((filePath) => slots.has(Uri.file(filePath).toString()));
}

/** Сам файл не трогаем — запись и переименование перекрывают цель сами. `null` — цели нет или она не файл. */
async function keepAside(files: IFileService, target: string): Promise<{ restore(): Promise<void> } | null> {
    const kept = await readTextFile(files, target);
    if (kept === null) return null;
    return {
        restore: () => writeTextFile(files, target, kept.text, kept.encoding),
    };
}

async function shallowestMissingAncestor(files: IFileService, target: string): Promise<string> {
    let current = target;
    let parent = path.dirname(current);
    // Stryker disable next-line ConditionalExpression: стоп на корне — предохранитель от вечного цикла; у дискового провайдера корень существует всегда, и цикл кончается раньше
    while (parent !== current && !(await files.exists(Uri.file(parent)))) {
        current = parent;
        parent = path.dirname(current);
    }
    return current;
}

async function moveBack(files: IFileService, src: string, originalPath: string): Promise<string> {
    const dest = await resolveNonConflictingDest(files, path.dirname(originalPath), path.basename(originalPath));
    await moveToPath(files, src, dest);
    return dest;
}

/** Как VS Code/Finder: `name` → `name copy` → `name copy 2` → …, расширение файла сохраняется. */
async function resolveNonConflictingDest(files: IFileService, targetDir: string, name: string): Promise<string> {
    const direct = path.join(targetDir, name);
    if (!(await files.exists(Uri.file(direct)))) return direct;

    const ext = path.extname(name);
    const base = ext ? name.slice(0, -ext.length) : name;

    for (let i = 1; ; i++) {
        const suffix = i === 1 ? " copy" : ` copy ${String(i)}`;
        const candidate = path.join(targetDir, `${base}${suffix}${ext}`);
        if (!(await files.exists(Uri.file(candidate)))) return candidate;
    }
}

async function moveToPath(files: IFileService, src: string, dest: string): Promise<void> {
    await files.move(Uri.file(src), Uri.file(dest), true);
}

/** Каталог внутрь самого себя не пустит провайдер (отказ ОС) — отдельной проверки не нужно. */
async function copyInto(files: IFileService, src: string, targetDir: string): Promise<string> {
    const dest = await resolveNonConflictingDest(files, targetDir, path.basename(src));
    await files.copy(Uri.file(src), Uri.file(dest));
    return dest;
}

async function moveInto(files: IFileService, src: string, targetDir: string): Promise<string> {
    if (path.dirname(src) === targetDir) return src;

    const dest = await resolveNonConflictingDest(files, targetDir, path.basename(src));
    await moveToPath(files, src, dest);
    return dest;
}

export const WorkspaceEditServiceDIToken = token<WorkspaceEditService>("WorkspaceEditService");
