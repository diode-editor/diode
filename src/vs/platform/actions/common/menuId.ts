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
    /**
     * `editor/title/run`: the Run or Debug split button of {@link EditorTitle}. Resolved with the same context as
     * its parent; the button runs the item last picked from its dropdown.
     */
    public static readonly EditorTitleRun = new MenuId("EditorTitleRun");
    /** Targets the instance under the mouse (`TerminalTabMenuContext`). */
    public static readonly TerminalTabContext = new MenuId("TerminalTabContext");
    /**
     * Filtered by `menuContext.view` (`viewMenuVisible`): a global when key does not
     * work, since the sidebar shows several sections at once. The section's header also
     * resolves it with its own `view` key, so an extension's `when: view == <id>` holds there.
     */
    public static readonly ViewTitle = new MenuId("ViewTitle");
    /**
     * `view/item/context`: a row of an extension's tree. The tree resolves it per row with its own `view` and
     * `viewItem` keys; the `inline` group is the row's glyph buttons, the rest its context menu.
     */
    public static readonly ViewItemContext = new MenuId("ViewItemContext");
    /**
     * `testing/item/context`: a row of the Test Explorer, resolved per row with its `testId`, `controllerId` and
     * `testing.testItemHasUri` keys; the `inline` group is the row's glyph buttons, the rest its context menu.
     */
    public static readonly TestItem = new MenuId("TestItem");
    /**
     * `testing/item/gutter`: the menu of a test glyph in the editor gutter, resolved per test with the same keys as
     * {@link TestItem}; its items follow the built-in ones.
     */
    public static readonly TestItemGutter = new MenuId("TestItemGutter");
    /**
     * `testing/message/context`: a message row of the TEST RESULTS tree, resolved per message with its `testMessage`,
     * `testResultOutdated`, `controllerId`, `testId` and resource keys; the `inline` group is the row's glyph buttons,
     * the rest its context menu.
     */
    public static readonly TestMessageContext = new MenuId("TestMessageContext");
    /** `testing/message/content`: the buttons over a shown message, resolved with the keys of {@link TestMessageContext}. */
    public static readonly TestMessageContent = new MenuId("TestMessageContent");
    /** Filtered by `menuContext.container` (`containerMenuVisible`). */
    public static readonly ViewContainerTitle = new MenuId("ViewContainerTitle");
    /**
     * `debug/toolBar`: the buttons of the debug toolbar, its `navigation` group with icons (upstream registers each
     * item in {@link ViewContainerTitle} too, for `debug.toolBarLocation: docked`).
     */
    public static readonly DebugToolBar = new MenuId("DebugToolBar");
    /**
     * The context menus of the debug views' rows (`debug/callstack/context`, `debug/variables/context`,
     * `debug/watch/context`; the scopes, breakpoints and console ones have no extension point). Resolved per row with
     * the row's keys (`callStackItemType`, `variableEvaluateNamePresent`, …); the `inline` group stays off the menu.
     */
    public static readonly DebugCallStackContext = new MenuId("DebugCallStackContext");
    public static readonly DebugVariablesContext = new MenuId("DebugVariablesContext");
    public static readonly DebugWatchContext = new MenuId("DebugWatchContext");
    public static readonly DebugBreakpointsContext = new MenuId("DebugBreakpointsContext");
    public static readonly DebugConsoleContext = new MenuId("DebugConsoleContext");
    /** `debug/createConfiguration` (proposed upstream): extra picks of the debugger choice when launch.json is made. */
    public static readonly DebugCreateConfiguration = new MenuId("DebugCreateConfiguration");
    /**
     * Not a menu but the palette's filter (upstream `MenuId.CommandPalette`): a command without items here is
     * always listed, one with items only while the `when` of one of them holds.
     */
    public static readonly CommandPalette = new MenuId("CommandPalette");
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
