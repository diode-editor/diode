import type { GroupId } from "../../services/editor/browser/editorGroupModel.ts";

/**
 * Конвенции контекста открытия меню (`context` в `MenuRegistry.getMenuItems`):
 * - `MenuId.EditorContext`, меню-бар → `undefined`;
 * - `MenuId.ExplorerContext` → {@link ExplorerMenuContext};
 * - `MenuId.EditorTitleContext` → {@link EditorTitleMenuContext};
 * - `MenuId.ScmContext` → {@link ScmMenuContext};
 * - `MenuId.ScmGraphContext` → {@link ScmGraphMenuContext}.
 *
 * Хелперы ниже используются в co-located размещениях экшенов
 * (`CommandAction.menus`) для резолва аргументов и императивной видимости.
 */
export interface ExplorerMenuContext {
    /** Путь выделенного узла дерева. */
    readonly path: string;
    /** Непустой буфер обмена файлов — видимость Paste. */
    readonly canPaste: boolean;
}

/** Аргумент команды Explorer — путь выделенного узла. */
export const explorerPathArg = (context: unknown): readonly unknown[] => [(context as ExplorerMenuContext).path];

/** Видимость Paste — непустой буфер обмена файлов (императивно, при открытии). */
export const explorerCanPaste = (context: unknown): boolean => (context as ExplorerMenuContext).canPaste;

/** По чему открыто SCM-меню: файловая строка, папка дерева или заголовок группы. */
export type ScmMenuTargetKind = "resource" | "folder" | "group";

/**
 * Контекст SCM-меню (`MenuId.ScmContext` / `MenuId.ScmResourceGroupContext`).
 * Цели множественные: выделение списка, файлы под папкой или вся группа. Группы
 * целей (`merge | index | worktree | untracked`, строками — слой) определяют
 * видимость stage/unstage/discard; команда сама фильтрует цели по применимости.
 */
export interface ScmMenuContext {
    readonly kind: ScmMenuTargetKind;
    /** URI целевых файлов (строками — аргументы команд сериализуемы). */
    readonly uris: readonly string[];
    /** Уникальные группы целей. */
    readonly groups: readonly string[];
}

/** Аргумент множественных SCM-команд — все целевые uri. */
export const scmUrisArg = (context: unknown): readonly unknown[] => [(context as ScmMenuContext).uris];

/** Аргумент одиночных SCM-команд (Open File / Open Changes) — единственная цель. */
export const scmSingleUriArg = (context: unknown): readonly unknown[] => [(context as ScmMenuContext).uris[0]];

/** Видимость одиночных команд: меню открыто по файловой строке с одной целью. */
export const scmSingleResource = (context: unknown): boolean => {
    const ctx = context as ScmMenuContext;
    return ctx.kind === "resource" && ctx.uris.length === 1;
};

/** Видимость групповых команд: среди целей есть хотя бы одна из данных групп. */
export const scmHasAnyGroup =
    (...groups: readonly string[]) =>
    (context: unknown): boolean =>
        (context as ScmMenuContext).groups.some((g) => groups.includes(g));

/**
 * Контекст меню коммита в графе (`MenuId.ScmGraphContext`). Цель всегда одна —
 * строка, по которой открыли меню; множественного выделения у истории нет.
 */
export interface ScmGraphMenuContext {
    /** Полный sha — аргумент git-операций. */
    readonly sha: string;
    readonly shortSha: string;
    readonly subject: string;
}

/** Аргумент команд графа — sha коммита под меню. */
export const scmGraphShaArg = (context: unknown): readonly unknown[] => [(context as ScmGraphMenuContext).sha];

/** Аргумент Copy Commit Message — тема коммита под меню. */
export const scmGraphSubjectArg = (context: unknown): readonly unknown[] => [
    (context as ScmGraphMenuContext).subject,
];

/**
 * Контекст меню «⋯» view-секции сайдбара (`MenuId.ViewTitle`):
 * пункты фильтруются императивно по id секции — глобальный when-ключ здесь
 * не годится, в сайдбаре видимы несколько секций одновременно.
 */
export interface ViewMenuContext {
    /** Id view-секции, чьё меню открыто (см. `IViewDescriptor.id`). */
    readonly view: string;
}

/** Видимость пункта меню «⋯» — только в меню своей view-секции. */
export const viewMenuVisible =
    (viewId: string) =>
    (context: unknown): boolean =>
        (context as ViewMenuContext | undefined)?.view === viewId;

/**
 * Контекст меню «⋯» заголовка КОНТЕЙНЕРА (`MenuId.ViewContainerTitle`).
 * Фильтрация та же императивная, что у секций: в сайдбаре одновременно живут
 * несколько контейнеров, и глобальный when-ключ их не различает.
 */
export interface ViewContainerMenuContext {
    /** Id контейнера, чьё меню открыто (см. `IViewContainerDescriptor.id`). */
    readonly container: string;
}

/** Видимость пункта меню «⋯» — только в меню своего контейнера. */
export const containerMenuVisible =
    (containerId: string) =>
    (context: unknown): boolean =>
        (context as ViewContainerMenuContext | undefined)?.container === containerId;

/**
 * Контекст меню вкладки редактора (`MenuId.EditorTitleContext`). Цель — вкладка
 * ПОД КУРСОРОМ, а не активная: правый клик по табу активной вкладки не меняет
 * (как в VS Code), поэтому команды получают адрес `(groupId, index)` аргументом,
 * а не читают `activeGroup`/`activeIndex`.
 *
 * Признаки состава группы (`tabCount`, `hasTabsToTheRight`, `hasSavedTabs`)
 * снимаются в момент открытия и решают видимость пунктов императивно: `when`
 * здесь не годится — глобальные контекст-ключи не различают вкладку под курсором,
 * а disabled-пунктов у `MenuRegistry` нет.
 */
export interface EditorTitleMenuContext {
    readonly groupId: GroupId;
    /** Позиция вкладки в своей группе. */
    readonly index: number;
    /** Абсолютный путь файла вкладки; `null` у безымянного буфера и диффа. */
    readonly path: string | null;
    readonly tabCount: number;
    readonly hasTabsToTheRight: boolean;
    /** Есть ли в группе вкладки без несохранённых правок — видимость Close Saved. */
    readonly hasSavedTabs: boolean;
}

/** Аргументы команд вкладки — адрес вкладки под курсором. */
export const editorTabTargetArg = (context: unknown): readonly unknown[] => {
    const ctx = context as EditorTitleMenuContext;
    return [ctx.groupId, ctx.index];
};

/** Аргумент файловых команд вкладки — путь её файла. */
export const editorTabPathArg = (context: unknown): readonly unknown[] => [
    (context as EditorTitleMenuContext).path,
];

/** Видимость файловых пунктов: у вкладки есть файл на диске. */
export const editorTabIsFile = (context: unknown): boolean => (context as EditorTitleMenuContext).path !== null;

/** Видимость Close Others: в группе есть что закрывать помимо целевой вкладки. */
export const editorTabHasOthers = (context: unknown): boolean => (context as EditorTitleMenuContext).tabCount > 1;

/** Видимость Close to the Right: справа от целевой вкладки что-то есть. */
export const editorTabHasTabsToTheRight = (context: unknown): boolean =>
    (context as EditorTitleMenuContext).hasTabsToTheRight;

/** Видимость Close Saved: в группе есть вкладки без несохранённых правок. */
export const editorTabHasSavedTabs = (context: unknown): boolean =>
    (context as EditorTitleMenuContext).hasSavedTabs;
