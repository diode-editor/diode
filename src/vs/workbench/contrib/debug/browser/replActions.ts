// The Debug Console's commands with upstream's ids, titles, keys and `when` (`debug.contribution.ts`, `repl.ts`).
// Deviations: Ctrl+Shift+Y reaches only terminals with extended keys, Ctrl+K Y toggles the console everywhere (as
// Ctrl+K M for Problems); Enter in the input is the input's own key (it calls `repl.action.acceptInput`'s method), and
// Clear Console has no key: upstream binds Cmd+K on macOS only. Focus Filter's Ctrl+F is bound in the console (its
// precondition) rather than in any text input: the console's input is its only one. Copy of the row's menu copies the
// row (the terminal has no text selection in the console to copy instead). Next/Previous Debug Console take
// Ctrl+PageDown/PageUp in the console, over the editor's tab switching.

import { codicon } from "../../../../base/common/codicons.ts";
import { removeAnsiEscapeCodes } from "../../../../base/common/strings.ts";
import { type CommandAction, HIDDEN_FROM_PALETTE } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { QuickOpenServiceDIToken } from "../../quickaccess/browser/quickOpenService.ts";
import { type IDebugService, type IDebugSession, type IReplElement, REPL_VIEW_ID, State } from "../common/debug.ts";
import { resolveChildSession } from "../common/debugUtils.ts";
import { ReplEvaluationResult } from "../common/replModel.ts";

import { rowMenuItem } from "./debugContextMenus.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { showReplIfHidden } from "./debugSessionPicker.ts";
import { ReplDIToken, SELECT_REPL_ID } from "./repl.ts";

export const TOGGLE_REPL_ID = "workbench.debug.action.toggleRepl";
export const FOCUS_REPL_ID = "workbench.debug.action.focusRepl";
export const ACCEPT_REPL_INPUT_ID = "repl.action.acceptInput";
export const CLEAR_REPL_ID = "workbench.debug.panel.action.clearReplAction";
export const FILTER_REPL_ID = "repl.action.filter";
export const COPY_ALL_REPL_ID = "repl.action.copyAll";
export const COLLAPSE_REPL_ID = "debug.collapseRepl";
export const SELECT_DEBUG_CONSOLE_ID = "workbench.action.debug.selectDebugConsole";
export const DEBUG_CONSOLE_QUICK_ACCESS_PREFIX = "debug consoles ";
export const NEXT_DEBUG_CONSOLE_ID = "workbench.action.debug.nextConsole";
export const PREV_DEBUG_CONSOLE_ID = "workbench.action.debug.prevConsole";

/** Upstream `registerDebugCommandPaletteItem`: listed only with debuggers. */
const DEBUG_PALETTE = [{ menuId: MenuId.CommandPalette, when: "debuggersAvailable" }];

/** Upstream `changeDebugConsoleFocus`: the next (or previous) session with a console of its own, round. */
async function changeDebugConsoleFocus(
    debugService: IDebugService,
    views: Pick<ViewsService, "isViewShown" | "openView">,
    next: boolean,
): Promise<void> {
    const sessions = debugService
        .getModel()
        .getSessions(true)
        .filter((s) => s.hasSeparateRepl());
    let currSession = debugService.getViewModel().focusedSession;

    let nextIndex = 0;
    if (currSession) {
        // A root has a console of its own: the walk up ends at one (upstream checks for none at both ends).
        while (currSession.parentSession && !currSession.hasSeparateRepl()) {
            currSession = currSession.parentSession;
        }

        // Round: past the last is the first, and `at(-1)` before the first is the last.
        nextIndex = (sessions.indexOf(currSession) + (next ? 1 : -1)) % sessions.length;
    }
    await debugService.focusStackFrame(undefined, undefined, sessions.at(nextIndex), { explicit: true });
    showReplIfHidden(views);
}

export const toggleReplAction: CommandAction = {
    id: TOGGLE_REPL_ID,
    title: "View: Toggle Debug Console",
    shortTitle: "Debug Console",
    // Upstream: between Output and Terminal.
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 30.5 }],
    keybinding: parseChord("ctrl+k y"),
    keybindings: [{ keys: parseKeybinding("mod+shift+y"), when: "tier != 'legacy'" }],
    run(accessor) {
        // Shown and hidden where it is: the console may have been moved out of the panel.
        const views = accessor.get(ViewsServiceDIToken);
        if (views.isViewShown(REPL_VIEW_ID)) {
            views.closeView(REPL_VIEW_ID);
            return;
        }
        views.openView(REPL_VIEW_ID, true);
    },
};

export const focusReplAction: CommandAction = {
    id: FOCUS_REPL_ID,
    title: "Debug: Focus on Debug Console View",
    run(accessor) {
        accessor.get(ViewsServiceDIToken).openView(REPL_VIEW_ID, true);
    },
};

export const acceptReplInputAction: CommandAction = {
    id: ACCEPT_REPL_INPUT_ID,
    title: "Debug Console: Accept Input",
    enablement: "inDebugRepl",
    run(accessor) {
        accessor.get(ReplDIToken).acceptReplInput();
    },
};

export const clearReplAction: CommandAction = {
    id: CLEAR_REPL_ID,
    title: "Clear Console",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: codicon("clear-all"),
            visible: viewMenuVisible(REPL_VIEW_ID),
        },
        rowMenuItem(MenuId.DebugConsoleContext, "z_commands", 20),
    ],
    run(accessor) {
        accessor.get(ReplDIToken).clearRepl();
    },
};

export const replPasteAction: CommandAction = {
    id: "debug.replPaste",
    title: "Paste",
    enablement: "debugState != 'inactive'",
    menus: [...HIDDEN_FROM_PALETTE, rowMenuItem(MenuId.DebugConsoleContext, "2_cutcopypaste", 30)],
    async run(accessor) {
        const clipboardText = await accessor.get(ClipboardDIToken).readText();
        if (clipboardText) accessor.get(ReplDIToken).paste(clipboardText);
    },
};

export const copyAllAction: CommandAction = {
    id: "workbench.debug.action.copyAll",
    title: "Copy All",
    menus: [...HIDDEN_FROM_PALETTE, rowMenuItem(MenuId.DebugConsoleContext, "2_cutcopypaste", 20)],
    run(accessor) {
        return accessor.get(ClipboardDIToken).writeText(accessor.get(ReplDIToken).getVisibleContent());
    },
};

/** Upstream's `tryEvaluateAndCopy`: an evaluation's result as the adapter gives it for the clipboard. */
async function tryEvaluateAndCopy(debugService: IDebugService, element: IReplElement): Promise<string | undefined> {
    // todo: we should expand DAP to allow copying more types here (#187784)
    if (!(element instanceof ReplEvaluationResult)) {
        return;
    }

    const stackFrame = debugService.getViewModel().focusedStackFrame;
    const session = debugService.getViewModel().focusedSession;
    if (!stackFrame || !session?.capabilities.supportsClipboardContext) {
        return;
    }

    // A request that fails, synchronously or not, is no answer: the row is copied as shown.
    const evaluation = await Promise.resolve()
        .then(() => session.evaluate(element.originalExpression, stackFrame.frameId, "clipboard"))
        .catch(() => undefined);
    return evaluation?.body.result;
}

export const replCopyAction: CommandAction = {
    id: "debug.replCopy",
    title: "Copy",
    menus: [...HIDDEN_FROM_PALETTE, rowMenuItem(MenuId.DebugConsoleContext, "2_cutcopypaste", 10)],
    async run(accessor, element) {
        if (element === undefined) return;
        const row = element as IReplElement;
        const retValue = await tryEvaluateAndCopy(accessor.get(DebugServiceDIToken), row);
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- upstream: an empty string is none too
        const textToCopy = retValue || removeAnsiEscapeCodes(row.toString());
        await accessor.get(ClipboardDIToken).writeText(textToCopy);
    },
};

export const filterReplAction: CommandAction = {
    id: FILTER_REPL_ID,
    title: "Debug Console: Focus Filter",
    enablement: "inDebugRepl",
    // Over the editor's Find (same weight upstream, decided there by the registration order): in the console Ctrl+F filters.
    keybindings: [{ keys: parseKeybinding("mod+f"), when: "inDebugRepl", weight: KeybindingWeight.EditorContrib + 1 }],
    run(accessor) {
        accessor.get(ReplDIToken).focusFilter();
    },
};

export const copyAllReplAction: CommandAction = {
    id: COPY_ALL_REPL_ID,
    title: "Debug: Console Copy All",
    enablement: "inDebugRepl",
    async run(accessor) {
        await accessor.get(ClipboardDIToken).writeText(accessor.get(ReplDIToken).getVisibleContent());
    },
};

export const collapseReplAction: CommandAction = {
    id: COLLAPSE_REPL_ID,
    title: "Collapse All",
    menus: [rowMenuItem(MenuId.DebugConsoleContext, "z_commands", 10)],
    run(accessor) {
        const repl = accessor.get(ReplDIToken);
        repl.collapseAll();
        repl.focus();
    },
};

export const selectDebugConsoleAction: CommandAction = {
    id: SELECT_DEBUG_CONSOLE_ID,
    title: "Debug: Select Debug Console",
    menus: DEBUG_PALETTE,
    run(accessor) {
        accessor.get(QuickOpenServiceDIToken).show(DEBUG_CONSOLE_QUICK_ACCESS_PREFIX);
    },
};

export const nextDebugConsoleAction: CommandAction = {
    id: NEXT_DEBUG_CONSOLE_ID,
    title: "Debug: Focus Next Debug Console",
    menus: DEBUG_PALETTE,
    keybindings: [
        { keys: parseKeybinding("mod+pagedown"), when: "inDebugRepl", weight: KeybindingWeight.WorkbenchContrib + 1 },
    ],
    run(accessor) {
        return changeDebugConsoleFocus(accessor.get(DebugServiceDIToken), accessor.get(ViewsServiceDIToken), true);
    },
};

export const prevDebugConsoleAction: CommandAction = {
    id: PREV_DEBUG_CONSOLE_ID,
    title: "Debug: Focus Previous Debug Console",
    menus: DEBUG_PALETTE,
    keybindings: [
        { keys: parseKeybinding("mod+pageup"), when: "inDebugRepl", weight: KeybindingWeight.WorkbenchContrib + 1 },
    ],
    run(accessor) {
        return changeDebugConsoleFocus(accessor.get(DebugServiceDIToken), accessor.get(ViewsServiceDIToken), false);
    },
};

/** Upstream's `selectReplCommandId`: what the console's select of sessions runs (`f1: false`). */
export const selectReplAction: CommandAction = {
    id: SELECT_REPL_ID,
    title: "Select Debug Console",
    menus: HIDDEN_FROM_PALETTE,
    async run(accessor, arg) {
        const debugService = accessor.get(DebugServiceDIToken);
        let session = arg as IDebugSession | undefined;
        // If session is already the focused session we need to manualy update the tree since view model will not send a focused change event
        if (session && session.state !== State.Inactive && session !== debugService.getViewModel().focusedSession) {
            session = resolveChildSession(session, debugService.getModel().getSessions());
            await debugService.focusStackFrame(undefined, undefined, session, { explicit: true });
        }
        // Need to select the session in the view since the focussed session might not have changed
        accessor.get(ReplDIToken).selectSession(session);
    },
};

export const REPL_ACTIONS: readonly CommandAction[] = [
    replCopyAction,
    copyAllAction,
    replPasteAction,
    toggleReplAction,
    focusReplAction,
    acceptReplInputAction,
    // Upstream's order in repl.ts.
    copyAllReplAction,
    filterReplAction,
    clearReplAction,
    collapseReplAction,
    selectReplAction,
    selectDebugConsoleAction,
    nextDebugConsoleAction,
    prevDebugConsoleAction,
];
