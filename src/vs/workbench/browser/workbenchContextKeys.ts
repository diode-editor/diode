import type { TUIFocusEvent } from "@tuidom/core/dom/events/tuiFocusEvent";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { EditorPartElement } from "@tuidom/elements/editorpart/editorPartElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { Disposable } from "../../base/common/lifecycle.ts";
import { EditorElement } from "../../editor/browser/editorElement.ts";
import { isTextViewElement } from "../../editor/browser/iTextViewElement.ts";
import type { IContextKeyContributor } from "../../platform/contextkey/common/contextKeyContributor.ts";
import { ContextKeyContributorsDIToken } from "../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor, Token } from "../../platform/instantiation/common/diContainer.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { IEditorGroupsService } from "../services/editor/common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";
import type { FocusTracker } from "../services/focus/browser/focusTracker.ts";
import { FocusTrackerDIToken } from "../services/focus/browser/focusTracker.ts";
import type { HistoryService } from "../services/history/browser/historyService.ts";
import { HistoryServiceDIToken } from "../services/history/browser/historyService.ts";
import type { KeybindingDispatcher } from "../services/keybinding/browser/keybindingDispatcher.ts";
import { KeybindingDispatcherDIToken } from "../services/keybinding/browser/keybindingDispatcher.ts";

export const WorkbenchContextKeysDIToken = token<WorkbenchContextKeys>("WorkbenchContextKeys");

/**
 * Workbench-level keys only; features set their own keys
 * ({@link IContextKeyContributor}) in the same {@link update}. Before {@link attachView}
 * there is no focus — the active element is `null`.
 */
export class WorkbenchContextKeys extends Disposable {
    public static dependencies = [
        ContextKeyServiceDIToken,
        EditorGroupsServiceDIToken,
        KeybindingDispatcherDIToken,
        HistoryServiceDIToken,
        FocusTrackerDIToken,
        ServiceAccessorDIToken,
        ContextKeyContributorsDIToken,
        IWorkspaceContextServiceDIToken,
    ] as const;

    private view: BodyElement | null = null;
    /** Resolved eagerly so the service startup order does not depend on the first keystroke. */
    private readonly contributors: readonly IContextKeyContributor[];

    public constructor(
        private readonly contextKeys: ContextKeyService,
        private readonly groups: IEditorGroupsService,
        private readonly dispatcher: KeybindingDispatcher,
        private readonly historyService: HistoryService,
        private readonly focusTracker: FocusTracker,
        accessor: ServiceAccessor,
        contributorTokens: readonly Token<IContextKeyContributor>[],
        private readonly workspaceContext: Pick<IWorkspaceContextService, "getWorkbenchState">,
    ) {
        super();
        this.contributors = contributorTokens.map((contributor) => accessor.get(contributor));
        this.dispatcher.updateContextKeys = () => {
            this.update();
        };
        // Auto-lock happens while opening, with no focus change of its own.
        this.register(
            groups.onDidChangeGroupLocked(() => {
                this.update();
            }),
        );
    }

    public attachView(view: BodyElement): void {
        this.view = view;
    }

    public handleFocusChange = (_event: TUIFocusEvent): void => {
        this.dispatcher.cancelPendingChord();
        this.update();
        // After the recompute: subscribers (editor popups) already see the refreshed context.
        this.focusTracker.fire(this.activeElement());
    };

    public update(): void {
        const active = this.activeElement();
        const editorCount = this.groups.activeGroup.editorCount;

        this.contextKeys.set("textInputFocus", active instanceof EditorElement);
        // Broader than textInputFocus in when-clause semantics: "the command needs a cursor"
        // vs "the command needs input" (mutating commands are also gated on `!editorReadonly`).
        this.contextKeys.set("textViewFocus", isTextViewElement(active));
        // Upstream names: extension manifests use `editorTextFocus` and `editorLangId`.
        this.contextKeys.set("editorTextFocus", active instanceof EditorElement);
        this.contextKeys.set("editorLangId", isTextViewElement(active) ? active.viewState.document.languageId : "");
        // Our counterpart of `EditorContextKeys.writable`. Without text focus it is false,
        // otherwise the key would stick from the previous editor.
        this.contextKeys.set("editorReadonly", isTextViewElement(active) && active.readOnly);
        // Gates Escape for `removeSecondaryCursors`: without it Escape would always be intercepted.
        this.contextKeys.set(
            "editorHasMultipleSelections",
            isTextViewElement(active) && active.viewState.selections.length > 1,
        );
        this.contextKeys.set("inputWidgetFocus", active instanceof InputElement);
        this.contextKeys.set("listFocus", active instanceof TreeViewElement || active instanceof ListViewElement);
        this.contextKeys.set("editorGroupHasEditors", editorCount > 0);
        this.contextKeys.set("editorTabsMultiple", editorCount > 1);
        this.contextKeys.set("multipleEditorGroups", this.groups.groups.length > 1);
        this.contextKeys.set("canNavigateBack", this.historyService.canGoBack);
        this.contextKeys.set("canNavigateForward", this.historyService.canGoForward);
        this.contextKeys.set("activeEditorGroupEmpty", editorCount === 0);
        this.contextKeys.set("activeEditorGroupIndex", this.groups.viewColumnOf(this.groups.activeGroup));
        this.contextKeys.set(
            "activeEditorGroupLast",
            this.groups.activeGroup === this.groups.groups[this.groups.groups.length - 1],
        );
        this.contextKeys.set("activeEditorGroupLocked", this.groups.activeGroup.isLocked);
        this.contextKeys.set("terminalFocus", active instanceof TerminalViewElement);
        // Upstream name. Overlays (palette, dialogs, menus) live outside the part, so they read false.
        this.contextKeys.set(
            "editorAreaFocus",
            active?.getAncestorPath().some((element) => element instanceof EditorPartElement) ?? false,
        );
        // Upstream key: workspace commands show in the command palette only with a folder open.
        this.contextKeys.set("workbenchState", this.workspaceContext.getWorkbenchState());
        // Upstream key. No trust model here: every workspace is trusted, same as `workspace.isTrusted`.
        this.contextKeys.set("isWorkspaceTrusted", true);
        for (const contributor of this.contributors) {
            contributor.updateContextKeys(this.contextKeys, active);
        }
    }

    private activeElement(): TUIElement | null {
        return this.view?.focusManager?.activeElement ?? null;
    }
}
