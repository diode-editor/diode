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
    /** Контекст-меню коммита в графе (VS Code `scm/historyItem/context`). */
    public static readonly ScmGraphContext = new MenuId("ScmGraphContext");
    /**
     * Действия заголовка ОДНОЙ view — VS Code `ViewTitle`. Группа `navigation`
     * рисуется inline-кнопками в заголовке, остальные группы уезжают в попап
     * «⋯». Пункты фильтруются императивно по `menuContext.view`
     * (см. `viewMenuVisible`): глобальный when-ключ не годится — в сайдбаре
     * одновременно видно несколько секций.
     */
    public static readonly ViewTitle = new MenuId("ViewTitle");
    /**
     * Меню «⋯» заголовка КОНТЕЙНЕРА view-секций («активити») — VS Code
     * `ViewContainerTitle`. Фильтруется императивно по `menuContext.container`
     * (см. `containerMenuVisible`), как `ViewTitle` по view.
     */
    public static readonly ViewContainerTitle = new MenuId("ViewContainerTitle");
    /** Корень меню-бара: содержит только submenu-пункты (File/Edit/…). */
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
