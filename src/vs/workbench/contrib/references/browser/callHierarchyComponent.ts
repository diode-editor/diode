import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import { CancellationTokenSource, LatestRequest } from "../../../../base/common/cancellation.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    CallHierarchyProvider,
    ICallHierarchyItem,
} from "../../../../editor/common/languages/iCallHierarchySource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import { HeaderBodyViewElement } from "../../../browser/parts/views/headerBodyViewElement.ts";
import { ViewMessageElement } from "../../../browser/parts/views/viewMessageElement.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { CALL_HIERARCHY_MODE_STATE, type CallHierarchyMode } from "../../../common/stateKeys.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";

import { CallHierarchyTreeProvider, callNodeTarget, CallsModel, type ICallNode } from "./callHierarchyModel.ts";
import type { IReferencesRevealTarget, ReferencesComponent } from "./referencesComponent.ts";
import {
    REFERENCES_VIEW_ID,
    REFERENCES_VIEWLET_ID,
    ReferencesComponentDIToken,
    ReferencesRevealTargetDIToken,
} from "./referencesComponent.ts";
import { revealLocation } from "./revealLocation.ts";

export const CallHierarchyComponentDIToken = token<CallHierarchyComponent>("CallHierarchyComponent");

export const CALL_HIERARCHY_VIEW_ID = "references-view.hierarchy";

const NO_RESULTS = "No results.";

interface ISession {
    readonly provider: CallHierarchyProvider;
    readonly sessionId: number;
    /** What `prepare` answered: the roots to go back to when no row is selected. */
    readonly roots: readonly ICallHierarchyItem[];
    readonly cancellation: CancellationTokenSource;
}

/**
 * Upstream's `references-view` extension, `calls/`: the tree next to the list of references, in the same container.
 * The section exists only while there is a tree, so the container doesn't show an empty one.
 */
export class CallHierarchyComponent extends Disposable {
    public static dependencies = [
        ViewsServiceDIToken,
        ReferencesComponentDIToken,
        EditorServiceDIToken,
        LanguageFeaturesServiceDIToken,
        ReferencesRevealTargetDIToken,
        JumpRecorderDIToken,
        StateServiceDIToken,
        ContextKeyServiceDIToken,
        NotificationServiceDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private readonly latest = new LatestRequest();
    private readonly provider: CallHierarchyTreeProvider;
    private readonly message = new ViewMessageElement();
    private readonly root: HeaderBodyViewElement;
    public readonly tree: TreeViewElement<ICallNode>;

    private session: ISession | null = null;
    private model: CallsModel | null = null;
    private direction: CallHierarchyMode;

    public constructor(
        private readonly viewsService: ViewsService,
        references: ReferencesComponent,
        private readonly group: IEditorService,
        private readonly languageFeatures: ILanguageFeaturesService,
        private readonly revealTarget: IReferencesRevealTarget,
        private readonly jumps: IJumpRecorder,
        private readonly state: IStateService,
        private readonly contextKeys: ContextKeyService,
        private readonly notifications: NotificationService,
        icons: IProductIconService,
    ) {
        super();
        this.direction = state.get(CALL_HIERARCHY_MODE_STATE);
        contextKeys.set("callHierarchyMode", this.direction);

        this.provider = new CallHierarchyTreeProvider(icons);
        this.tree = new TreeViewElement(this.provider, { leftPadding: 1 });
        this.tree.id = "callHierarchyTree";
        this.tree.onActivate = (node) => {
            this.activate(node);
        };
        const scrollBars = new ScrollBarDecorator(this.tree);
        this.root = new HeaderBodyViewElement(this.message, scrollBars);
        this.root.id = "callHierarchyView";
        this.root.style = { fg: "sideBar.foreground", bg: "sideBar.background" };

        // The list of references takes the panel back: the tree it replaces has no way to return.
        this.register(
            references.onDidRevealResults(() => {
                this.dismiss();
            }),
        );
        this.register(this.latest);
        this.register({
            dispose: () => {
                this.releaseSession();
            },
        });
    }

    /** Nothing at the caret: a toast, and the tree that is already there stays (upstream core, `No results`). */
    public async show(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        // Upstream `CallHierarchyModel.create`: the first provider by score answers alone.
        const provider = this.languageFeatures.callHierarchyProvider.ordered(editor).at(0);
        // Stryker disable next-line ConditionalExpression: the command's `when` hides it without a provider, and the palette goes through `when` too
        if (provider === undefined) return;

        const caret = editor.viewState.selections[0].active;
        const ticket = this.latest.start();
        const prepared = await provider.prepareCallHierarchy(
            {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                versionId: editor.model.document.versionId,
                line: caret.line,
                character: caret.character,
            },
            ticket.token,
        );
        if (ticket.isStale()) {
            if (prepared !== null) provider.releaseCallHierarchy(prepared.sessionId);
            return;
        }
        if (prepared === null) {
            this.notifications.show({ severity: "info", message: "No results", modal: false, items: [] });
            return;
        }

        this.releaseSession();
        this.session = {
            provider,
            sessionId: prepared.sessionId,
            roots: prepared.items,
            cancellation: new CancellationTokenSource(),
        };
        await this.showRoots(prepared.items);
    }

    /** Upstream `setMode`: the tree reroots on the selected row, and without one on what it was opened on. */
    public async setDirection(direction: CallHierarchyMode): Promise<void> {
        if (direction === this.direction) return;
        this.direction = direction;
        this.state.store(CALL_HIERARCHY_MODE_STATE, direction);
        this.contextKeys.set("callHierarchyMode", direction);
        if (this.session === null) return;
        const selected = this.tree.getSelectedNode();
        // The selected item is already in the session: no need for its document to be open to prepare it anew.
        await this.showRoots(selected === null ? this.session.roots : [selected.item]);
    }

    /** Upstream `references-view.removeCallItem`, for the whole tree: a tree of one root has nothing else to remove. */
    public dismiss(): void {
        this.latest.cancel();
        // Stryker disable next-line ConditionalExpression: a repeated dismiss would only repeat idempotent calls
        if (this.session === null) return;
        this.releaseSession();
        this.model = null;
        this.provider.setModel(null);
        void this.tree.refresh();
        this.message.setText("");
        this.viewsService.setViewVisible(REFERENCES_VIEW_ID, true);
        this.viewsService.unregisterView(CALL_HIERARCHY_VIEW_ID);
        this.contextKeys.set("callHierarchyVisible", false);
    }

    private releaseSession(): void {
        this.session?.cancellation.cancel();
        this.session?.provider.releaseCallHierarchy(this.session.sessionId);
        this.session = null;
    }

    private async showRoots(roots: readonly ICallHierarchyItem[]): Promise<void> {
        const session = this.session;
        /* v8 ignore start -- both callers have just checked or set the session */
        // Stryker disable next-line ConditionalExpression: unreachable for the same reason
        if (session === null) return;
        /* v8 ignore stop */
        const model = new CallsModel(
            session.provider,
            session.sessionId,
            this.direction,
            roots,
            session.cancellation.token,
        );
        this.model = model;
        this.provider.setModel(model);
        this.message.setText("");

        this.viewsService.registerView({
            id: CALL_HIERARCHY_VIEW_ID,
            containerId: REFERENCES_VIEWLET_ID,
            // Stryker disable next-line StringLiteral: `setViewTitle` right below replaces it on the frame
            title: "CALL HIERARCHY",
            order: 20,
            body: this.root,
            focus: () => {
                this.tree.focus();
            },
        });
        this.viewsService.setViewTitle(
            CALL_HIERARCHY_VIEW_ID,
            this.direction === "incoming" ? "Callers Of" : "Calls From",
            roots[0].name,
        );
        this.viewsService.setViewVisible(CALL_HIERARCHY_VIEW_ID, true);
        this.viewsService.setViewVisible(REFERENCES_VIEW_ID, false);
        this.contextKeys.set("callHierarchyVisible", true);
        this.viewsService.openView(CALL_HIERARCHY_VIEW_ID, true);

        await this.tree.refresh();
        const [root] = model.roots;
        await this.tree.expand(root);
        const children = await model.getChildren(root);
        // Replaced or dismissed while the provider was answering: the rows belong to another tree now.
        if (this.model !== model) return;
        const first = children.at(0);
        await this.tree.reveal(first === undefined ? [root] : [root, first]);
        // The only root with nothing under it: the tree alone would look like it is still loading.
        if (first === undefined && model.roots.length === 1) this.message.setText(NO_RESULTS);
    }

    private activate(node: ICallNode): void {
        const position = callNodeTarget(this.direction, node);
        revealLocation(
            this.revealTarget,
            this.jumps,
            node.item.uri,
            createRange(position.line, position.character, position.line, position.character),
        );
    }
}
