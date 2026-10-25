/** Compared by instance identity; ids are unique. */
export class MenuId {
    private static readonly instances = new Set<string>();

    public static readonly EditorContext = new MenuId("EditorContext");
    public static readonly ExplorerContext = new MenuId("ExplorerContext");
    public static readonly ScmContext = new MenuId("ScmContext");
    public static readonly ScmResourceGroupContext = new MenuId("ScmResourceGroupContext");
    public static readonly ScmGraphContext = new MenuId("ScmGraphContext");
    /**
     * Targets the tab under the mouse, not the active one: items address it via `menuContext`
     * (`EditorTitleMenuContext`), and visibility is imperative (`visible`), not via when keys.
     */
    public static readonly EditorTitleContext = new MenuId("EditorTitleContext");
    /** Opened with `EditorTitleBarMenuContext` (the group id) as context. */
    public static readonly EditorTitle = new MenuId("EditorTitle");
    /** Targets the instance under the mouse (`TerminalTabMenuContext`). */
    public static readonly TerminalTabContext = new MenuId("TerminalTabContext");
    /**
     * Filtered by `menuContext.view` (`viewMenuVisible`): a global when key does not
     * work, since the sidebar shows several sections at once. The section's header also
     * resolves it with its own `view` key, so an extension's `when: view == <id>` holds there.
     */
    public static readonly ViewTitle = new MenuId("ViewTitle");
    /** Filtered by `menuContext.container` (`containerMenuVisible`). */
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
            throw new Error(`MenuId "${id}" already exists: ids must be unique`);
        }
        MenuId.instances.add(id);
    }
}
