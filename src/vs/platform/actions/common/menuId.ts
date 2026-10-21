/** Сравнение — по идентичности инстанса; id уникальны. */
export class MenuId {
    private static readonly instances = new Set<string>();

    public static readonly EditorContext = new MenuId("EditorContext");
    public static readonly ExplorerContext = new MenuId("ExplorerContext");
    public static readonly ScmContext = new MenuId("ScmContext");
    public static readonly ScmResourceGroupContext = new MenuId("ScmResourceGroupContext");
    public static readonly ScmGraphContext = new MenuId("ScmGraphContext");
    /**
     * Цель — вкладка под курсором, а не активная: пункты адресуются через `menuContext`
     * (`EditorTitleMenuContext`), видимость — императивно (`visible`), не when-ключами.
     */
    public static readonly EditorTitleContext = new MenuId("EditorTitleContext");
    /** Контекст открытия — `EditorTitleBarMenuContext` (id группы). */
    public static readonly EditorTitle = new MenuId("EditorTitle");
    /** Цель — инстанс под курсором (`TerminalTabMenuContext`). */
    public static readonly TerminalTabContext = new MenuId("TerminalTabContext");
    /**
     * Фильтруется по `menuContext.view` (`viewMenuVisible`): глобальный when-ключ не
     * годится — в сайдбаре одновременно видно несколько секций.
     */
    public static readonly ViewTitle = new MenuId("ViewTitle");
    /** Фильтруется по `menuContext.container` (`containerMenuVisible`). */
    public static readonly ViewContainerTitle = new MenuId("ViewContainerTitle");
    public static readonly MenubarMainMenu = new MenuId("MenubarMainMenu");
    public static readonly MenubarFileMenu = new MenuId("MenubarFileMenu");
    public static readonly MenubarEditMenu = new MenuId("MenubarEditMenu");
    public static readonly MenubarSelectionMenu = new MenuId("MenubarSelectionMenu");
    public static readonly MenubarViewMenu = new MenuId("MenubarViewMenu");
    public static readonly MenubarGoMenu = new MenuId("MenubarGoMenu");
    public static readonly MenubarTerminalMenu = new MenuId("MenubarTerminalMenu");
    public static readonly MenubarHelpMenu = new MenuId("MenubarHelpMenu");

    public constructor(public readonly id: string) {
        if (MenuId.instances.has(id)) {
            throw new Error(`MenuId "${id}" уже существует — id должны быть уникальны`);
        }
        MenuId.instances.add(id);
    }
}
