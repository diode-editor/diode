/**
 * Конвенции контекста открытия меню (`context` в `MenuRegistry.getMenuItems`):
 * - `MenuId.EditorContext`, меню-бар → `undefined`;
 * - `MenuId.ExplorerContext` → {@link ExplorerMenuContext};
 * - `MenuId.ScmContext` → {@link ScmMenuContext}.
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

export interface ScmMenuContext {
    /** URI изменённого файла (строкой — аргументы команд сериализуемы). */
    readonly uri: string;
}

/** Аргумент SCM-команд — uri строки, по которой открыто меню. */
export const scmUriArg = (context: unknown): readonly unknown[] => [(context as ScmMenuContext).uri];

/**
 * Контекст меню «⋯» view-секции сайдбара (`MenuId.ViewMoreActions`):
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
