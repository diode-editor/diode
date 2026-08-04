/**
 * Точки, куда контрибьютятся пункты меню (аналог класса `MenuId` VS Code).
 * Пункт объявляет свой `menuId`, а сборщик меню (контекст-меню, меню-бар)
 * запрашивает `MenuRegistry.getMenuItems(menuId, …)`. Класс расширяем:
 * новая точка (в т.ч. из расширения) — `new MenuId("my.menu")`; id уникальны,
 * сравнение — по идентичности инстанса.
 */
export class MenuId {
    private static readonly instances = new Set<string>();

    public static readonly EditorContext = new MenuId("EditorContext");
    public static readonly ExplorerContext = new MenuId("ExplorerContext");
    public static readonly ScmContext = new MenuId("ScmContext");
    /** Контекст-меню заголовка группы ресурсов SCM (VS Code `scm/resourceGroup/context`). */
    public static readonly ScmResourceGroupContext = new MenuId("ScmResourceGroupContext");
    /** Корень меню-бара: содержит только submenu-пункты (File/Edit/…). */
    /** Контролы активной вкладки в шапке (панель/сайдбар) — VS Code `ViewTitle`. */
    public static readonly ViewTitle = new MenuId("ViewTitle");
    /**
     * Меню «⋯» view-секции сайдбара — overflow-часть VS Code `ViewTitle`.
     * Отдельная точка: `ViewTitle` фильтруется глобальным when-ключом `view`
     * (= активная вкладка нижней панели), а в сайдбаре видимы несколько секций
     * сразу — пункты фильтруются императивно по `menuContext.view`
     * (см. `viewMenuVisible`).
     */
    public static readonly ViewMoreActions = new MenuId("ViewMoreActions");
    public static readonly MenubarMainMenu = new MenuId("MenubarMainMenu");
    public static readonly MenubarFileMenu = new MenuId("MenubarFileMenu");
    public static readonly MenubarEditMenu = new MenuId("MenubarEditMenu");
    public static readonly MenubarSelectionMenu = new MenuId("MenubarSelectionMenu");
    public static readonly MenubarViewMenu = new MenuId("MenubarViewMenu");
    public static readonly MenubarGoMenu = new MenuId("MenubarGoMenu");
    public static readonly MenubarHelpMenu = new MenuId("MenubarHelpMenu");

    public constructor(public readonly id: string) {
        if (MenuId.instances.has(id)) {
            throw new Error(`MenuId "${id}" уже существует — id должны быть уникальны`);
        }
        MenuId.instances.add(id);
    }
}
