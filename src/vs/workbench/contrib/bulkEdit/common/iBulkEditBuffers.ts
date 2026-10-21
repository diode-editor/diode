import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { IUndoParticipant } from "../../../../platform/undoRedo/common/undoRedoService.ts";

/**
 * Открытый ресурс правится через документ и остаётся грязным, а не переписывается на диске: иначе
 * буфер и файл разъехались бы, а несохранённые правки пропали.
 */
export interface IBulkEditBuffer {
    /** По нему клампятся координаты, присланные расширением. */
    text(): string;
    /**
     * Шаг отдаётся вызывающему: он войдёт в общий шаг на весь edit, а не в бакет документа.
     * `null` — правки ничего не изменили.
     */
    applyEdits(edits: readonly ITextEdit[], label: string): IUndoRedoElement | null;
    /** Отказ сохранения — не ошибка: буфер остаётся грязным, как у эталона (тот лишь пишет в лог). */
    save(): Promise<void>;
}

/**
 * `"read-only"` — открыт, но правка не состоится (`jdt:`, сторона диффа): edit отбивается целиком.
 * `null` — не открыт, правим по диску.
 */
export type BulkEditTarget = IBulkEditBuffer | "read-only" | null;

/** Ресурс — `uri.toString()`. */
export interface IBulkEditBuffers {
    get(resource: string): BulkEditTarget;
    /**
     * Бакеты для ОДНОГО шага на весь edit. Каждый открытый тронутый ресурс — участник: Ctrl+Z из любой
     * его вкладки откатывает весь шаг. Не тронут ни один — участник один, без правки: вкладка, где
     * вызвали действие. Пусто — шаг идёт в бакет workspace-операций.
     */
    undoParticipants(touched: readonly string[]): IUndoParticipant[];
    /**
     * Удалён в корзину мимо файлового сервиса — `FileOperation.Delete` не придёт; с вкладками
     * поступаем так же: чистые под ресурсом закрываются.
     */
    didDelete(resource: string): void;
}

export const NULL_BULK_EDIT_BUFFERS: IBulkEditBuffers = {
    get: () => null,
    undoParticipants: () => [],
    didDelete: () => {
        /* вкладок нет — закрывать нечего */
    },
};

export const IBulkEditBuffersDIToken = token<IBulkEditBuffers>("IBulkEditBuffers");
