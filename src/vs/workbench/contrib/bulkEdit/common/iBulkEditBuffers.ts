import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { IUndoParticipant } from "../../../../platform/undoRedo/common/undoRedoService.ts";

/**
 * Открытый буфер ресурса — цель текстовых правок bulk edit'а.
 *
 * Ресурс, который кто-то держит открытым, правится через свой документ и
 * остаётся «грязным», а не переписывается на диске: иначе буфер и файл
 * разъехались бы, а несохранённые правки пользователя пропали. У закрытого
 * ресурса буфера нет — его правит сам `WorkspaceEditService` записью на диск.
 */
export interface IBulkEditBuffer {
    /** Текст документа — по нему клампятся координаты, присланные расширением. */
    text(): string;
    /**
     * Применяет правки ОДНИМ шагом истории документа и отдаёт этот шаг
     * вызывающему: шаг войдёт в общий шаг на весь edit, а не в бакет документа
     * (см. `TextFileModel.applyExternalEditsDetached`).
     *
     * `null` — применять нечего (правки ничего не изменили).
     */
    applyEdits(edits: readonly ITextEdit[], label: string): IUndoRedoElement | null;
    /**
     * Сохраняет буфер, если он изменён (`files.refactoring.autoSave`). Отказ
     * сохранения (конфликт с диском, безымянный буфер) — не ошибка: буфер
     * остаётся грязным, как у эталона, который лишь пишет его в лог.
     */
    save(): Promise<void>;
}

/**
 * Что bulk edit видит по ресурсу:
 * - буфер — ресурс открыт и правится через него;
 * - `"read-only"` — открыт, но правка не состоится (виртуальный документ
 *   `jdt:`, сторона диффа): edit отбивается целиком, врать расширению об успехе
 *   нельзя;
 * - `null` — не открыт, правим по диску.
 */
export type BulkEditTarget = IBulkEditBuffer | "read-only" | null;

/** Доступ к открытым буферам по ресурсу (`uri.toString()`). */
export interface IBulkEditBuffers {
    get(resource: string): BulkEditTarget;
    /**
     * Бакеты истории, в которые ложится ОДИН шаг на весь edit
     * (`UndoRedoService.pushWorkspaceElement`). `touched` — ресурсы с правками
     * в открытых буферах, в порядке появления в edit'е.
     *
     * Каждый открытый тронутый ресурс — участник со своей правкой: Ctrl+Z из
     * любой его вкладки откатывает весь шаг. Не тронут ни один открытый —
     * участник один, без правки: вкладка, в которой вызвали действие. Пусто —
     * вкладок нет, и шаг идёт в общий бакет workspace-операций (отмена в
     * проводнике).
     */
    undoParticipants(touched: readonly string[]): IUndoParticipant[];
    /**
     * Ресурс удалён мимо файлового сервиса — в системную корзину (`ITrashService`),
     * поэтому `FileOperation.Delete` от сервиса не придёт. Реализация поступает с
     * вкладками так же, как на него: чистые под ресурсом закрываются.
     */
    didDelete(resource: string): void;
}

/**
 * Открытых буферов нет — весь edit ложится на диск. Дефолт для профилей без
 * редактора (node-режим, тесты сервиса) и значение до связывания в DI.
 */
export const NULL_BULK_EDIT_BUFFERS: IBulkEditBuffers = {
    get: () => null,
    undoParticipants: () => [],
    didDelete: () => {
        /* вкладок нет — закрывать нечего */
    },
};

export const IBulkEditBuffersDIToken = token<IBulkEditBuffers>("IBulkEditBuffers");
