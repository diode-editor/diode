import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { Event } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../platform/commands/common/commandRegistry.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../platform/instantiation/common/diContainer.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../browser/parts/views/viewsService.ts";
import { type IViewWelcomeTarget, ViewWelcomeElement } from "../../browser/parts/views/viewWelcomeElement.ts";
import { ExternalOpenerDIToken, type IExternalOpener } from "../../services/externalOpener/common/iExternalOpener.ts";

import { DEFAULT_WELCOME_WHEN, type IViewWelcomeContent, welcomeBlocks } from "./viewsWelcomeExtensionPoint.ts";

/** The tree side of a section: upstream `TreeViewPane.shouldShowWelcome` and its change event. */
export interface IWelcomeTree {
    readonly view: TUIElement;
    /** The root has no rows (or was not read yet) and there is no `TreeView.message`. */
    shouldShowWelcome(): boolean;
    readonly onDidChangeWelcomeState: Event<void>;
}

interface IViewState {
    readonly contents: readonly IViewWelcomeContent[];
    tree: IWelcomeTree | null;
    treeListener: IDisposable | null;
    /** Indexes of the shown entries, the key of {@link welcome}: the same set keeps the element (and its focus). */
    shown: string;
    welcome: ViewWelcomeElement | null;
}

/**
 * Upstream `ViewWelcomeController` for extension views: the section body is the welcome while the tree has
 * nothing to show (no provider yet, an empty root) and some `viewsWelcome` entry of the view applies,
 * otherwise the tree. Entries are re-evaluated on every context change (`setContext`, `config.*`); a change
 * that leaves the same entries shown only updates `enablement`, so the frame and the focus stay.
 */
export class ExtensionViewWelcomes {
    public static dependencies = [
        ViewsServiceDIToken,
        ContextKeyServiceDIToken,
        CommandRegistryDIToken,
        ExternalOpenerDIToken,
    ] as const;

    private readonly states = new Map<string, IViewState>();

    public constructor(
        private readonly views: ViewsService,
        private readonly contextKeys: Pick<ContextKeyService, "evaluate" | "onDidChange">,
        private readonly commands: CommandRegistry,
        private readonly opener: IExternalOpener,
    ) {
        // A window-wide singleton: there is nobody to dispose the subscription.
        contextKeys.onDidChange(() => {
            for (const viewId of this.states.keys()) this.sync(viewId);
        });
    }

    /** Once, before the extensions start: the entries of every view, keyed by view id. */
    public registerContents(contents: ReadonlyMap<string, readonly IViewWelcomeContent[]>): void {
        for (const [viewId, list] of contents) {
            this.states.set(viewId, { contents: list, tree: null, treeListener: null, shown: "", welcome: null });
            this.sync(viewId);
        }
    }

    /** The extension registered (or, with `null`, disposed) the view's tree. */
    public setTree(viewId: string, tree: IWelcomeTree | null): void {
        const state = this.states.get(viewId);
        if (state === undefined) {
            this.views.setViewBody(viewId, tree?.view ?? null);
            return;
        }
        state.treeListener?.dispose();
        state.tree = tree;
        state.treeListener =
            tree?.onDidChangeWelcomeState(() => {
                this.sync(viewId);
            }) ?? null;
        this.sync(viewId);
    }

    /** The shown welcome of a view, `null` when the tree (or nothing) is shown. */
    public getWelcome(viewId: string): ViewWelcomeElement | null {
        const state = this.states.get(viewId);
        return state?.welcome ?? null;
    }

    private sync(viewId: string): void {
        const state = this.states.get(viewId);
        if (state === undefined) return;
        const shown = this.shownEntries(state.contents);
        const key = shown.join(",");
        if (key !== state.shown) {
            state.shown = key;
            state.welcome =
                shown.length === 0
                    ? null
                    : new ViewWelcomeElement(welcomeBlocks(shown.map((index) => state.contents[index])), (target) => {
                          this.open(target);
                      });
            if (state.welcome !== null) state.welcome.id = `viewWelcome-${viewId.replaceAll(".", "-")}`;
        }
        state.welcome?.updateEnablement((enablement) => this.contextKeys.evaluate(enablement));
        const tree = state.tree;
        const welcomeWanted = tree === null || tree.shouldShowWelcome();
        this.views.setViewBody(viewId, welcomeWanted && state.welcome !== null ? state.welcome : (tree?.view ?? null));
    }

    /** Upstream `getContentDescriptors`: every entry whose `when` holds; `"default"` only if none does. */
    private shownEntries(contents: readonly IViewWelcomeContent[]): number[] {
        const shown: number[] = [];
        let fallback = -1;
        for (const [index, { when }] of contents.entries()) {
            if (when === DEFAULT_WELCOME_WHEN) fallback = index;
            else if (when === undefined || this.contextKeys.evaluate(when)) shown.push(index);
        }
        if (shown.length === 0 && fallback >= 0) shown.push(fallback);
        return shown;
    }

    /** Upstream `openerService.open(href, { allowCommands: true })`: commands, and web links outside. */
    private open(target: IViewWelcomeTarget): void {
        if ("command" in target) {
            this.commands.execute(target.command, ...(target.args ?? []));
            return;
        }
        if (/^https?:/i.test(target.url)) void this.opener.open(target.url);
    }
}

export const ExtensionViewWelcomesDIToken = token<ExtensionViewWelcomes>("ExtensionViewWelcomes");
