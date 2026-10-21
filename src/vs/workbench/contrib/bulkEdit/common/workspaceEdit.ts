import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";

// Порядок операций значим: «Move to a new file» создаёт файл и тут же пишет в него, rename-рефакторинг
// правит импорты уже по новому пути.

export type FileEditKind = "create" | "delete" | "move" | "rename" | "copy";

/**
 * move/copy — `to` целевой каталог (как при вставке), rename — `to` точный путь.
 * `overwrite`/`ignoreIfExists`/`ignoreIfNotExists` — семантика `vscode.WorkspaceEdit`: без них коллизия
 * отбивает весь edit; `overwrite` бьёт `ignoreIfExists`.
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
          readonly contents?: string;
          readonly overwrite?: boolean;
          readonly ignoreIfExists?: boolean;
      };

/** Уже {@link ResourceFileEdit}: `move`/`copy` в каталог и создание каталога — виды проводника, в vscode API их нет. */
export type WorkspaceFileEdit =
    | {
          readonly kind: "create";
          readonly to: string;
          readonly contents?: string;
          readonly overwrite?: boolean;
          readonly ignoreIfExists?: boolean;
      }
    | Extract<ResourceFileEdit, { kind: "delete" | "rename" }>;

/** `resource` — `uri.toString()`. */
export interface ResourceTextEdit {
    readonly resource: string;
    readonly edits: readonly ITextEdit[];
}

export type ResourceEdit = ResourceFileEdit | ResourceTextEdit;

export type BulkEditOperation = WorkspaceFileEdit | ResourceTextEdit;

export type BulkEdit = readonly BulkEditOperation[];

export function isResourceFileEdit<T extends ResourceEdit | BulkEditOperation>(
    edit: T,
): edit is Extract<T, { readonly kind: string }> {
    return "kind" in edit;
}
