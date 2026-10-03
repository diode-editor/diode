import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";

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
     * Бакет истории, в который ложится ОДИН шаг на весь edit. `touched` —
     * ресурсы с правками в открытых буферах, в порядке появления в edit'е.
     *
     * Реализация отдаёт бакет того из них, который сейчас активен (Ctrl+Z
     * сработает там, где пользователь вызвал действие), иначе — первого.
     * `null` — бакета нет, и шаг идёт в общий бакет workspace-операций (отмена
     * в проводнике).
     */
    undoContext(touched: readonly string[]): string | null;
}

/**
 * Открытых буферов нет — весь edit ложится на диск. Дефолт для профилей без
 * редактора (node-режим, тесты сервиса) и значение до связывания в DI.
 */
export const NULL_BULK_EDIT_BUFFERS: IBulkEditBuffers = { get: () => null, undoContext: () => null };

export const IBulkEditBuffersDIToken = token<IBulkEditBuffers>("IBulkEditBuffers");
