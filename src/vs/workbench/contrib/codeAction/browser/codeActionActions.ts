import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { getCodeActions, type ICodeActionItem } from "../../../../editor/contrib/codeAction/codeAction.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";
import { selectionRange } from "../../format/browser/formatActions.ts";

/**
 * No stale guards like formatting has: the subprocess applies the edits via `workspace.applyEdit`,
 * atomically (all-or-nothing across open documents).
 */
async function runSourceAction(accessor: ServiceAccessor, only: string, noun: string): Promise<void> {
    const group = accessor.get(EditorServiceDIToken);
    const statusBar = accessor.get(StatusBarServiceDIToken);
    const languageFeatures = accessor.get(LanguageFeaturesServiceDIToken);
    const editor = group.getActiveEditor();
    if (editor === null) return;

    const notice = (text: string): void => {
        showTransientNotice(statusBar, "codeAction.notice", text);
    };

    const text = editor.getText();
    const lines = text.split("\n");
    const lastLine = lines.length - 1;
    const items = await getCodeActions(
        languageFeatures.codeActionProvider,
        editor,
        {
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            versionId: editor.model.document.versionId,
            // Source actions apply to the whole file, the selection doesn't matter (as in VS Code).
            range: createRange(0, 0, lastLine, lines[lastLine].length),
            only,
        },
        // One-shot command: the answer is needed even if the user edits the buffer —
        // the subprocess validates the edits itself when applying.
        CancellationTokenNone,
    );
    // Disabled ones are not applied. If there is nothing but them,
    // the user is shown the disabled reason, not "no actions"
    // (upstream: `getInvalidActionThatWouldHaveBeenApplied` in auto-apply).
    const valid = items.filter((item) => item.action.disabled === undefined);
    if (valid.length === 0) {
        notice(items.at(0)?.action.disabled ?? `No ${noun} action for '${editor.languageId}'`);
        return;
    }

    const pick: ICodeActionItem = valid.find((item) => item.action.isPreferred === true) ?? valid[0];
    const applied = await pick.provider.applyCodeAction(pick.action.id);
    if (!applied) notice(`Code action failed: ${pick.action.title}`);
}

/**
 * The terminal doesn't send Shift+Alt+O without extended keys: the canonical binding is behind the tier gate,
 * the path reachable everywhere is the leader chord Ctrl+K Alt+O.
 */
export const organizeImportsAction: CommandAction = {
    id: "editor.action.organizeImports",
    title: "Organize Imports",
    keybinding: parseChord("ctrl+k alt+o"),
    keybindings: [{ keys: parseKeybinding("shift+alt+o"), when: "tier != 'legacy'" }],
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return runSourceAction(accessor, "source.organizeImports", "organize imports");
    },
};

async function pickCodeAction(
    accessor: ServiceAccessor,
    options: { readonly only?: string; readonly title: string; readonly empty: string },
): Promise<void> {
    const group = accessor.get(EditorServiceDIToken);
    const statusBar = accessor.get(StatusBarServiceDIToken);
    const quickInput = accessor.get(QuickInputServiceDIToken);
    const languageFeatures = accessor.get(LanguageFeaturesServiceDIToken);
    const editor = group.getActiveEditor();
    if (editor === null) return;

    const notice = (text: string): void => {
        showTransientNotice(statusBar, "codeAction.notice", text);
    };

    const text = editor.getText();
    const found = await getCodeActions(
        languageFeatures.codeActionProvider,
        editor,
        {
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            versionId: editor.model.document.versionId,
            // Cursor/selection as in VS Code: actions in place (an empty
            // selection means the cursor line, to cover the line's diagnostics).
            range: selectionRange(editor.viewState.selections[0], text),
            // The spread keeps the request clean: `only: undefined` means "any kind".
            ...(options.only === undefined ? {} : { only: options.only }),
        },
        CancellationTokenNone,
    );
    // Disabled ones (`CodeAction.disabled`) as upstream
    // (`CodeActionController.showCodeActionList`): Quick Fix doesn't show them
    // at all, and a menu with a requested kind (refactorings, source) shows them
    // only when there are no active ones — with the reason. We have no "Show Disabled"
    // toggle and no grayed-out item rendering.
    const valid = found.filter(({ action }) => action.disabled === undefined);
    const shown = valid.length > 0 || options.only === undefined ? valid : found;
    if (shown.length === 0) {
        notice(options.empty);
        return;
    }

    // VS Code order: quickfixes above refactorings and source actions,
    // preferred first in its group. Providers are walked in registration
    // order, and without sorting one verbose provider (16 tsserver
    // refactorings) pushed linter fixes past the popup edge.
    const kindRank = (kind: string | undefined): number => {
        if (kind === undefined) return 3;
        if (kind === "quickfix" || kind.startsWith("quickfix.")) return 0;
        if (kind === "refactor" || kind.startsWith("refactor.")) return 1;
        if (kind === "source" || kind.startsWith("source.")) return 2;
        return 3;
    };
    const sorted = [...shown].sort(({ action: a }, { action: b }) => {
        const byKind = kindRank(a.kind) - kindRank(b.kind);
        if (byKind !== 0) return byKind;
        const aPreferred = a.isPreferred === true;
        // Stryker disable next-line ConditionalExpression,BooleanLiteral: which element of the pair lands in `b` is a TimSort detail; the aPreferred branch is enough to lift preferred, and on stable inputs the mutant is indistinguishable
        const bPreferred = b.isPreferred === true;
        // Stryker disable next-line ConditionalExpression: "always unequal" degenerates into a stable insertion in the same order — no observable difference
        if (aPreferred === bPreferred) return 0;
        return aPreferred ? -1 : 1;
    });
    const items = sorted.map(({ action }) => ({
        label: action.title,
        ...(action.kind === undefined ? {} : { description: action.kind }),
        ...(action.isPreferred === true ? { badge: "preferred" } : {}),
        // The disabled reason goes next to the title: upstream shows it in the
        // item's hover (menu with group headers, the default), we have no hovers.
        ...(action.disabled === undefined ? {} : { hint: action.disabled }),
    }));
    const picked = await quickInput.quickPick({
        title: options.title,
        placeholder: "Select Code Action",
        items,
    });
    if (picked === undefined) return;

    const pick = sorted[items.indexOf(picked)];
    if (pick.action.disabled !== undefined) {
        notice(pick.action.disabled);
        return;
    }
    const applied = await pick.provider.applyCodeAction(pick.action.id);
    if (!applied) notice(`Code action failed: ${pick.action.title}`);
}

/** The legacy terminal doesn't encode Ctrl+. — the second binding Ctrl+K Ctrl+Q is reachable everywhere. */
export const quickFixAction: CommandAction = {
    id: "editor.action.quickFix",
    title: "Quick Fix",
    keybinding: parseKeybinding("mod+."),
    keybindings: [parseChord("ctrl+k ctrl+q")],
    when: "textInputFocus && !editorReadonly",
    // Upstream's own group (`codeActionCommands.ts`): below the edit block.
    menus: [{ menuId: MenuId.EditorContext, group: "1_quickfix", order: 0, when: "editorHasCodeActionsProvider" }],
    run(accessor) {
        return pickCodeAction(accessor, { title: "Code Actions", empty: "No code actions available" });
    },
};

/**
 * Ctrl+Shift+R is indistinguishable from Ctrl+R on a legacy terminal: the canonical binding is behind the tier gate,
 * next to it the leader chord reachable everywhere.
 */
export const refactorAction: CommandAction = {
    id: "editor.action.refactor",
    title: "Refactor...",
    keybinding: parseChord("ctrl+k alt+r"),
    keybindings: [{ keys: parseKeybinding("mod+shift+r"), when: "tier != 'legacy'" }],
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.EditorContext, group: "1_modification", order: 2, when: "editorHasCodeActionsProvider" }],
    run(accessor) {
        return pickCodeAction(accessor, { only: "refactor", title: "Refactor", empty: "No refactorings available" });
    },
};

export const sourceActionAction: CommandAction = {
    id: "editor.action.sourceAction",
    title: "Source Action...",
    when: "textInputFocus && !editorReadonly",
    menus: [
        { menuId: MenuId.EditorContext, group: "1_modification", order: 2.1, when: "editorHasCodeActionsProvider" },
    ],
    run(accessor) {
        return pickCodeAction(accessor, {
            only: "source",
            title: "Source Action",
            empty: "No source actions available",
        });
    },
};

export const fixAllAction: CommandAction = {
    id: "editor.action.fixAll",
    title: "Fix All",
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return runSourceAction(accessor, "source.fixAll", "fix all");
    },
};

export const CODE_ACTION_ACTIONS: readonly CommandAction[] = [
    organizeImportsAction,
    fixAllAction,
    quickFixAction,
    refactorAction,
    sourceActionAction,
];
