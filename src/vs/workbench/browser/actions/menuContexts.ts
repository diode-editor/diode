import type { GroupId } from "../../services/editor/browser/editorGroupModel.ts";

/**
 * Menu open context (`context` in `MenuRegistry.getMenuItems`): `EditorContext`
 * and the menu bar pass `undefined`, the other `MenuId`s pass the interfaces below.
 */
export interface ExplorerMenuContext {
    readonly path: string;
    readonly canPaste: boolean;
}

export const explorerPathArg = (context: unknown): readonly unknown[] => [(context as ExplorerMenuContext).path];

/** Evaluated imperatively when the menu opens. */
export const explorerCanPaste = (context: unknown): boolean => (context as ExplorerMenuContext).canPaste;

export type ScmMenuTargetKind = "resource" | "folder" | "group";

/**
 * Targets are plural: the list selection, the files under a folder or the whole group. Target
 * groups decide stage/unstage/discard visibility; the command filters targets itself.
 */
export interface ScmMenuContext {
    readonly kind: ScmMenuTargetKind;
    /** Strings, so command arguments stay serializable. */
    readonly uris: readonly string[];
    readonly groups: readonly string[];
}

export const scmUrisArg = (context: unknown): readonly unknown[] => [(context as ScmMenuContext).uris];

export const scmSingleUriArg = (context: unknown): readonly unknown[] => [(context as ScmMenuContext).uris[0]];

/** The uri with its group: an `MM` file has one uri in two groups. */
export const scmSingleResourceArgs = (context: unknown): readonly unknown[] => {
    const ctx = context as ScmMenuContext;
    return [ctx.uris[0], ctx.groups[0]];
};

export const scmSingleResource = (context: unknown): boolean => {
    const ctx = context as ScmMenuContext;
    return ctx.kind === "resource" && ctx.uris.length === 1;
};

export const scmHasAnyGroup =
    (...groups: readonly string[]) =>
    (context: unknown): boolean =>
        (context as ScmMenuContext).groups.some((g) => groups.includes(g));

/** Always a single target: history has no multi-selection. */
export interface ScmGraphMenuContext {
    /** Full SHA. */
    readonly sha: string;
    readonly shortSha: string;
    readonly subject: string;
}

export const scmGraphShaArg = (context: unknown): readonly unknown[] => [(context as ScmGraphMenuContext).sha];

export const scmGraphSubjectArg = (context: unknown): readonly unknown[] => [(context as ScmGraphMenuContext).subject];

/**
 * Items are filtered imperatively by section id: several sections are visible in
 * the sidebar at once, and a global when key cannot tell them apart.
 */
export interface ViewMenuContext {
    readonly view: string;
}

export const viewMenuVisible =
    (viewId: string) =>
    (context: unknown): boolean =>
        (context as ViewMenuContext | undefined)?.view === viewId;

/** Filtered imperatively, like sections: a global when key cannot tell containers apart. */
export interface ViewContainerMenuContext {
    readonly container: string;
}

export const containerMenuVisible =
    (containerId: string) =>
    (context: unknown): boolean =>
        (context as ViewContainerMenuContext | undefined)?.container === containerId;

/**
 * The target is the tab UNDER THE POINTER, not the active one: a right click does not
 * activate it (as in VS Code), so commands receive the `(groupId, index)` address as an argument.
 * Item visibility is imperative, from traits captured at open time: global context
 * keys cannot tell the tab under the pointer apart, and there are no disabled items.
 */
export interface EditorTitleMenuContext {
    readonly groupId: GroupId;
    readonly index: number;
    /** `null` for an untitled buffer and a diff. */
    readonly path: string | null;
    /** Upstream's `resourceScheme`. */
    readonly resourceScheme: string;
    readonly tabCount: number;
    readonly hasTabsToTheRight: boolean;
    readonly hasSavedTabs: boolean;
    readonly isPreview: boolean;
}

/** Each group has its own bar, so the item learns which one it is in. */
export interface EditorTitleBarMenuContext {
    readonly groupId: GroupId;
    /** Per group, unlike the `activeEditorGroupLocked` key: an inactive locked group shows its own unlock button. */
    readonly groupLocked: boolean;
}

export const editorTitleBarGroupArg = (context: unknown): readonly unknown[] => [
    (context as EditorTitleBarMenuContext).groupId,
];

export const editorTitleBarGroupLocked = (context: unknown): boolean =>
    (context as EditorTitleBarMenuContext).groupLocked;

export const editorTabTargetArg = (context: unknown): readonly unknown[] => {
    const ctx = context as EditorTitleMenuContext;
    return [ctx.groupId, ctx.index];
};

export const editorTabPathArg = (context: unknown): readonly unknown[] => [(context as EditorTitleMenuContext).path];

export const editorTabIsFile = (context: unknown): boolean => (context as EditorTitleMenuContext).path !== null;

export const editorTabHasOthers = (context: unknown): boolean => (context as EditorTitleMenuContext).tabCount > 1;

export const editorTabHasTabsToTheRight = (context: unknown): boolean =>
    (context as EditorTitleMenuContext).hasTabsToTheRight;

export const editorTabHasSavedTabs = (context: unknown): boolean => (context as EditorTitleMenuContext).hasSavedTabs;

export const editorTabIsPreview = (context: unknown): boolean => (context as EditorTitleMenuContext).isPreview;
