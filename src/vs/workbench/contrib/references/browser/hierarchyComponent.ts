import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TreeViewElement } from "@tuidom/elements/tree/treeViewElement";

import {
    CancellationTokenSource,
    type ICancellationToken,
    LatestRequest,
} from "../../../../base/common/cancellation.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    ICallHierarchyItem,
    ICallHierarchyRequest,
    ICallHierarchySession,
} from "../../../../editor/common/languages/iCallHierarchySource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { HeaderBodyViewElement } from "../../../browser/parts/views/headerBodyViewElement.ts";
import { ViewMessageElement } from "../../../browser/parts/views/viewMessageElement.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import { HierarchyModel, HierarchyTreeProvider, type IHierarchyNode } from "./hierarchyTree.ts";
import type { IReferencesRevealTarget, ReferencesComponent } from "./referencesComponent.ts";
import { REFERENCES_VIEW_ID, REFERENCES_VIEWLET_ID } from "./referencesComponent.ts";
import { revealLocation } from "./revealLocation.ts";

/** Upstream's single section of the container: call and type trees take turns in it. */
export const HIERARCHY_VIEW_ID = "references-view.hierarchy";

const NO_RESULTS = "No results.";

/** What differs between the call tree and the type tree. */
export interface IHierarchyKind<TMode extends string, TProvider> {
    /** The ids of the tree and the view on the frame: `<prefix>Tree`, `<prefix>View`. */
    readonly idPrefix: string;
    readonly modeState: IStateDescriptor<TMode>;
    readonly modeKey: "callHierarchyMode" | "typeHierarchyMode";
    readonly visibleKey: "callHierarchyVisible" | "typeHierarchyVisible";
    providers(languageFeatures: ILanguageFeaturesService): LanguageFeatureRegistry<TProvider>;
    prepare(
        provider: TProvider,
        request: ICallHierarchyRequest,
        token: ICancellationToken,
    ): Promise<ICallHierarchySession | null>;
    release(provider: TProvider, sessionId: number): void;
    createModel(
        provider: TProvider,
        sessionId: number,
        direction: TMode,
        roots: readonly ICallHierarchyItem[],
        token: ICancellationToken,
    ): HierarchyModel;
    title(direction: TMode): string;
    /** Where Enter on a row goes. */
    target(direction: TMode, node: IHierarchyNode): IPosition;
}

interface ISession<TProvider> {
    readonly provider: TProvider;
    readonly sessionId: number;
    /** What `prepare` answered: the roots to go back to when no row is selected. */
    readonly roots: readonly ICallHierarchyItem[];
    readonly cancellation: CancellationTokenSource;
}

/**
 * Upstream's `references-view` extension: a tree next to the list of references, in the same container.
 * The section exists only while there is a tree, so the container doesn't show an empty one.
 */
export abstract class HierarchyComponent<TMode extends string, TProvider> extends Disposable {
    private readonly latest = new LatestRequest();
    private readonly provider: HierarchyTreeProvider;
    private readonly message = new ViewMessageElement();
    private readonly root: HeaderBodyViewElement;
    private readonly onWillShowEmitter = this.register(new Emitter<void>());
    public readonly tree: TreeViewElement<IHierarchyNode>;
    /** A tree is about to take the section: whoever holds it gives it up. */
    public readonly onWillShow: Event<void> = this.onWillShowEmitter.event;

    private session: ISession<TProvider> | null = null;
    private model: HierarchyModel | null = null;
    private direction: TMode;

    protected constructor(
        private readonly kind: IHierarchyKind<TMode, TProvider>,
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
        configuration: IConfigurationService,
    ) {
        super();
        this.direction = state.get(kind.modeState);
        contextKeys.set(kind.modeKey, this.direction);

        this.provider = new HierarchyTreeProvider(icons);
        this.tree = new TreeViewElement(this.provider, {
            leftPadding: 1,
            openOnSingleClick: () => configuration.get("workbench.list.openMode") !== "doubleClick",
        });
        this.tree.id = `${kind.idPrefix}Tree`;
        this.tree.onActivate = (node, options) => {
            this.activate(node);
            // A single click previews the location: the keyboard stays on the tree, as in Explorer.
            if (options.preserveFocus) this.tree.focus();
        };
        const scrollBars = new ScrollBarDecorator(this.tree);
        this.root = new HeaderBodyViewElement(this.message, scrollBars);
        this.root.id = `${kind.idPrefix}View`;
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

    public get view(): HeaderBodyViewElement {
        return this.root;
    }

    /** Nothing at the caret: a toast, and the tree that is already there stays (upstream core, `No results`). */
    public async show(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        // Upstream `CallHierarchyModel.create`, `TypeHierarchyModel.create`: the first provider by score answers alone.
        const provider = this.kind.providers(this.languageFeatures).ordered(editor).at(0);
        // Stryker disable next-line ConditionalExpression: the command's `when` hides it without a provider, and the palette goes through `when` too
        if (provider === undefined) return;

        const caret = editor.viewState.selections[0].active;
        const ticket = this.latest.start();
        const prepared = await this.kind.prepare(
            provider,
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
            if (prepared !== null) this.kind.release(provider, prepared.sessionId);
            return;
        }
        if (prepared === null) {
            this.notifications.show({ severity: "info", message: "No results", modal: false, items: [] });
            return;
        }

        this.onWillShowEmitter.fire();
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
    public async setDirection(direction: TMode): Promise<void> {
        if (direction === this.direction) return;
        this.direction = direction;
        this.state.store(this.kind.modeState, direction);
        this.contextKeys.set(this.kind.modeKey, direction);
        if (this.session === null) return;
        const selected = this.tree.getSelectedNode();
        // The selected item is already in the session: no need for its document to be open to prepare it anew.
        await this.showRoots(selected === null ? this.session.roots : [selected.item]);
    }

    /** Upstream's `removeCallItem`/`removeTypeItem`, for the whole tree: a tree of one root has nothing else to remove. */
    public dismiss(): void {
        this.latest.cancel();
        // Stryker disable next-line ConditionalExpression: a repeated dismiss would only repeat idempotent calls
        if (this.session === null) return;
        this.releaseSession();
        this.model = null;
        this.provider.setModel(null);
        void this.tree.refresh();
        // The container shows its remaining section by itself once this one is gone.
        this.viewsService.unregisterView(HIERARCHY_VIEW_ID);
        this.contextKeys.set(this.kind.visibleKey, false);
    }

    private releaseSession(): void {
        if (this.session === null) return;
        this.session.cancellation.cancel();
        this.kind.release(this.session.provider, this.session.sessionId);
        this.session = null;
    }

    private async showRoots(roots: readonly ICallHierarchyItem[]): Promise<void> {
        const session = this.session;
        /* v8 ignore start -- both callers have just checked or set the session */
        // Stryker disable next-line ConditionalExpression: unreachable for the same reason
        if (session === null) return;
        /* v8 ignore stop */
        const model = this.kind.createModel(
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
            id: HIERARCHY_VIEW_ID,
            containerId: REFERENCES_VIEWLET_ID,
            // Stryker disable next-line StringLiteral: `setViewTitle` right below replaces it on the frame
            title: "HIERARCHY",
            order: 20,
            body: this.root,
            focus: () => {
                this.tree.focus();
            },
        });
        this.viewsService.setViewTitle(HIERARCHY_VIEW_ID, this.kind.title(this.direction), roots[0].name);
        this.viewsService.setViewVisible(HIERARCHY_VIEW_ID, true);
        this.viewsService.setViewVisible(REFERENCES_VIEW_ID, false);
        this.contextKeys.set(this.kind.visibleKey, true);
        this.viewsService.openView(HIERARCHY_VIEW_ID, true);

        await this.tree.refresh();
        const [root] = model.roots;
        await this.tree.expand(root);
        const children = await model.getChildren(root);
        // Replaced or dismissed while the provider was answering: the rows belong to another tree now.
        if (this.model !== model) return;
        const first = children.at(0);
        if (first !== undefined) {
            await this.tree.reveal([root, first]);
            return;
        }
        // The only root with nothing under it: the tree alone would look like it is still loading.
        if (model.roots.length === 1) this.message.setText(NO_RESULTS);
    }

    private activate(node: IHierarchyNode): void {
        const position = this.kind.target(this.direction, node);
        revealLocation(
            this.revealTarget,
            this.jumps,
            node.item.uri,
            createRange(position.line, position.character, position.line, position.character),
        );
    }
}
