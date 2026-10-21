import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";

// Operation order matters: "Move to a new file" creates a file and writes to it right away, a rename refactoring
// fixes imports already on the new path.

export type FileEditKind = "create" | "delete" | "move" | "rename" | "copy";

/**
 * move/copy — `to` is the target directory (as on paste), rename — `to` is the exact path.
 * `overwrite`/`ignoreIfExists`/`ignoreIfNotExists` — `vscode.WorkspaceEdit` semantics: without them a collision
 * rejects the whole edit; `overwrite` beats `ignoreIfExists`.
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

/** Narrower than {@link ResourceFileEdit}: `move`/`copy` into a directory and creating a directory are explorer kinds, absent from the vscode API. */
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
