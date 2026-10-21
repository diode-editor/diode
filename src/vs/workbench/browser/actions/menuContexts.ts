import type { GroupId } from "../../services/editor/browser/editorGroupModel.ts";

/**
 * Контекст открытия меню (`context` в `MenuRegistry.getMenuItems`): `EditorContext`
 * и меню-бар — `undefined`, остальные `MenuId` — интерфейсы ниже.
 */
export interface ExplorerMenuContext {
    readonly path: string;
    readonly canPaste: boolean;
}

export const explorerPathArg = (context: unknown): readonly unknown[] => [(context as ExplorerMenuContext).path];

/** Императивно, при открытии меню. */
export const explorerCanPaste = (context: unknown): boolean => (context as ExplorerMenuContext).canPaste;

export type ScmMenuTargetKind = "resource" | "folder" | "group";

/**
 * Цели множественные: выделение списка, файлы под папкой или вся группа. Группы
 * целей решают видимость stage/unstage/discard; команда сама фильтрует цели.
 */
export interface ScmMenuContext {
    readonly kind: ScmMenuTargetKind;
    /** Строками — аргументы команд сериализуемы. */
    readonly uris: readonly string[];
    readonly groups: readonly string[];
}

export const scmUrisArg = (context: unknown): readonly unknown[] => [(context as ScmMenuContext).uris];

export const scmSingleUriArg = (context: unknown): readonly unknown[] => [(context as ScmMenuContext).uris[0]];

export const scmSingleResource = (context: unknown): boolean => {
    const ctx = context as ScmMenuContext;
    return ctx.kind === "resource" && ctx.uris.length === 1;
};

export const scmHasAnyGroup =
    (...groups: readonly string[]) =>
    (context: unknown): boolean =>
        (context as ScmMenuContext).groups.some((g) => groups.includes(g));

/** Цель всегда одна: множественного выделения у истории нет. */
export interface ScmGraphMenuContext {
    /** Полный sha. */
    readonly sha: string;
    readonly shortSha: string;
    readonly subject: string;
}

export const scmGraphShaArg = (context: unknown): readonly unknown[] => [(context as ScmGraphMenuContext).sha];

export const scmGraphSubjectArg = (context: unknown): readonly unknown[] => [(context as ScmGraphMenuContext).subject];

/**
 * Пункты фильтруются императивно по id секции: в сайдбаре видимы несколько
 * секций одновременно, и глобальный when-ключ их не различает.
 */
export interface ViewMenuContext {
    readonly view: string;
}

export const viewMenuVisible =
    (viewId: string) =>
    (context: unknown): boolean =>
        (context as ViewMenuContext | undefined)?.view === viewId;

/** Фильтрация императивная, как у секций: глобальный when-ключ контейнеры не различает. */
export interface ViewContainerMenuContext {
    readonly container: string;
}

export const containerMenuVisible =
    (containerId: string) =>
    (context: unknown): boolean =>
        (context as ViewContainerMenuContext | undefined)?.container === containerId;

/**
 * Цель — вкладка ПОД КУРСОРОМ, а не активная: правый клик её не активирует (как
 * в VS Code), поэтому команды получают адрес `(groupId, index)` аргументом.
 * Видимость пунктов — императивно по признакам, снятым при открытии: глобальные
 * контекст-ключи вкладку под курсором не различают, а disabled-пунктов нет.
 */
export interface EditorTitleMenuContext {
    readonly groupId: GroupId;
    readonly index: number;
    /** `null` у безымянного буфера и диффа. */
    readonly path: string | null;
    /** `resourceScheme` эталона. */
    readonly resourceScheme: string;
    readonly tabCount: number;
    readonly hasTabsToTheRight: boolean;
    readonly hasSavedTabs: boolean;
    readonly isPreview: boolean;
}

/** У каждой группы своя панель — пункт узнаёт, в какой он. */
export interface EditorTitleBarMenuContext {
    readonly groupId: GroupId;
}

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
