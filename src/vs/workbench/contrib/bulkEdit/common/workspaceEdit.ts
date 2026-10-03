import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";

/**
 * Модель правок уровня workspace (à la VS Code `WorkspaceEdit`): упорядоченный набор
 * операций над ресурсами — либо файловая операция, либо текстовая правка ресурса.
 *
 * Порядок значим: «Move to a new file» создаёт файл и тут же пишет в него, а
 * rename-рефакторинг переименовывает файл и правит импорты уже по новому пути.
 */

export type FileEditKind = "create" | "delete" | "move" | "rename" | "copy";

/**
 * Файловая операция. Дискриминируется по `kind`: набор полей зависит от вида правки.
 * - move/copy — источник `from` и целевой каталог `to` (как при вставке);
 * - rename — источник `from` и точный целевой путь `to` (переименование на месте);
 * - delete — только источник `from`;
 * - create — путь создаваемого ресурса `to` (+ `directory` для каталога).
 *
 * Опции `overwrite`/`ignoreIfExists`/`ignoreIfNotExists` — семантика
 * `vscode.WorkspaceEdit`: ими расширение говорит, что делать с уже
 * существующим (или уже отсутствующим) ресурсом. Без них коллизия — ошибка,
 * из-за которой edit не применяется целиком. `overwrite` бьёт `ignoreIfExists`
 * (дословно как в vscode API).
 */
export type ResourceFileEdit =
    | { readonly kind: "move"; readonly from: string; readonly to: string }
    | { readonly kind: "copy"; readonly from: string; readonly to: string }
    | {
          readonly kind: "rename";
          readonly from: string;
          readonly to: string;
          readonly overwrite?: boolean;
          readonly ignoreIfExists?: boolean;
      }
    | { readonly kind: "delete"; readonly from: string; readonly ignoreIfNotExists?: boolean }
    | {
          readonly kind: "create";
          readonly to: string;
          readonly directory?: boolean;
          /** Начальное содержимое создаваемого файла (vscode `createFile(…, { contents })`). */
          readonly contents?: string;
          readonly overwrite?: boolean;
          readonly ignoreIfExists?: boolean;
      };

/**
 * Файловые операции, которые бывают в `vscode.WorkspaceEdit`. Уже их, чем
 * {@link ResourceFileEdit}: перенос и копирование В КАТАЛОГ (`move`/`copy`) и
 * создание самого каталога — виды проводника, в этом API их нет. Поэтому
 * {@link WorkspaceEditService.applyWorkspaceEdit} и не умеет их проецировать:
 * сюда они не доходят по типам.
 */
export type WorkspaceFileEdit =
    | {
          readonly kind: "create";
          readonly to: string;
          readonly contents?: string;
          readonly overwrite?: boolean;
          readonly ignoreIfExists?: boolean;
      }
    | Extract<ResourceFileEdit, { kind: "delete" | "rename" }>;

/** Текстовые правки одного ресурса; `resource` — `uri.toString()`. */
export interface ResourceTextEdit {
    readonly resource: string;
    readonly edits: readonly ITextEdit[];
}

export type ResourceEdit = ResourceFileEdit | ResourceTextEdit;

/** Одна операция `workspace.applyEdit`: файловая либо текстовая. */
export type BulkEditOperation = WorkspaceFileEdit | ResourceTextEdit;

/** Весь `workspace.applyEdit` — операции в порядке, в котором их добавило расширение. */
export type BulkEdit = readonly BulkEditOperation[];

/** Файловая операция (а не текстовая правка ресурса) — по дискриминатору `kind`. */
export function isResourceFileEdit<T extends ResourceEdit | BulkEditOperation>(
    edit: T,
): edit is Extract<T, { readonly kind: string }> {
    return "kind" in edit;
}
