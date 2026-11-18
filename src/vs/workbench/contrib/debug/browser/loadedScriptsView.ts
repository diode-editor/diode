/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/loadedScriptsView.ts
// LOADED SCRIPTS: the sources the sessions' adapters loaded (`loadedSources`, then the `loadedSource` events), under
// the session when there are several, by folder: the workspace's relative to it, others tildified, `http(s)` ones under
// their host, `<…>` ones last; a folder of one folder is drawn as one row (`a/b`), as upstream's compressed tree.
// Enter or a click opens an available source. Deviations: the rows have no file icons; upstream's filter of the
// `loadedSource` events without a reason is not here (the tree has no type-to-filter), and a `changed` source's open
// document is not reloaded (see `debugContentProvider.ts`).

import { isAbsolute, normalize, posix } from "node:path";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable, DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { type IRowSpan, LazyTreeControl } from "../../../browser/parts/views/lazyTreeControl.ts";
import type { IDebugService, IDebugSession } from "../common/debug.ts";
import type { Source } from "../common/debugSource.ts";

import type { IBreakpointSources } from "./breakpointsView.ts";

// RFC 2396, Appendix A: https://www.ietf.org/rfc/rfc2396.txt
const URI_SCHEMA_PATTERN = /^[a-zA-Z][a-zA-Z0-9+\-.]+:/u;
const URL_REGEXP = /^(https?:\/\/[^/]+)(\/.*)$/u;
/** Upstream's delay of the tree's update after a change. */
export const LOADED_SCRIPTS_REFRESH_DELAY_MS = 300;

export class BaseTreeItem {
    private showedMoreThanOne = false;
    private readonly children = new Map<string, BaseTreeItem>();
    private source: Source | undefined;

    public constructor(
        private readonly parent: BaseTreeItem | undefined,
        private label: string,
    ) {}

    public updateLabel(label: string): void {
        this.label = label;
    }

    public getSession(): IDebugSession | undefined {
        return this.parent?.getSession();
    }

    public setSource(session: IDebugSession, source: Source): void {
        this.source = source;
        this.children.clear();
        for (const src of source.raw.sources ?? []) {
            if (src.name && src.path) {
                const s = new BaseTreeItem(this, src.name);
                this.children.set(src.path, s);
                s.setSource(session, session.getSource(src));
            }
        }
    }

    public createIfNeeded<T extends BaseTreeItem>(key: string, factory: (parent: BaseTreeItem, label: string) => T): T {
        let child = this.children.get(key) as T | undefined;
        if (!child) {
            child = factory(this, key);
            this.children.set(key, child);
        }
        return child;
    }

    public getChild(key: string): BaseTreeItem | undefined {
        return this.children.get(key);
    }

    public remove(key: string): void {
        this.children.delete(key);
    }

    public removeFromParent(): void {
        if (this.parent) {
            this.parent.remove(this.label);
            if (this.parent.children.size === 0) {
                this.parent.removeFromParent();
            }
        }
    }

    // a dynamic ID based on the parent chain; required for reparenting (see #55448)
    public getId(): string {
        const parent = this.getParent();
        return parent ? `${parent.getId()}/${this.getInternalId()}` : this.getInternalId();
    }

    public getInternalId(): string {
        return this.label;
    }

    // skips intermediate single-child nodes
    public getParent(): BaseTreeItem | undefined {
        if (this.parent?.isSkipped()) {
            return this.parent.getParent();
        }
        return this.parent;
    }

    public isSkipped(): boolean {
        // roots are never skipped; skipped if I'm the only child of my parents
        return this.parent ? this.parent.oneChild() !== undefined : true;
    }

    // skips intermediate single-child nodes
    public hasChildren(): boolean {
        const child = this.oneChild();
        if (child) {
            return child.hasChildren();
        }
        return this.children.size > 0;
    }

    // skips intermediate single-child nodes
    public getChildren(): BaseTreeItem[] {
        const child = this.oneChild();
        if (child) {
            return child.getChildren();
        }
        return [...this.children.values()].sort((a, b) => this.compare(a, b));
    }

    // skips intermediate single-child nodes; joined as upstream's compressed rows (the old style's ` • ` after a
    // workspace folder was its hover)
    public getLabel(): string {
        const child = this.oneChild();
        if (child) {
            return `${this.label}${posix.sep}${child.getLabel()}`;
        }
        return this.label;
    }

    // skips intermediate single-child nodes
    public getSource(): Source | undefined {
        const child = this.oneChild();
        if (child) {
            return child.getSource();
        }
        return this.source;
    }

    protected compare(a: BaseTreeItem, b: BaseTreeItem): number {
        return a.label.localeCompare(b.label);
    }

    /**
     * Upstream's "new style" compression: the root skips its one session, and the compressible tree draws a folder of
     * one child with it as one row (`src/main.cpp`). The tree here compresses nothing: the model skips such a folder,
     * the old style's way. A session row stays its own, as upstream's incompressible one.
     */
    private oneChild(): BaseTreeItem | undefined {
        if (!this.source && !this.showedMoreThanOne && !(this instanceof SessionTreeItem)) {
            if (this.children.size === 1) {
                return this.children.values().next().value;
            }
            // if a node had more than one child once, it will never be skipped again
            if (this.children.size > 1) {
                this.showedMoreThanOne = true;
            }
        }
        return undefined;
    }
}

class RootFolderTreeItem extends BaseTreeItem {
    public constructor(
        parent: BaseTreeItem,
        public readonly folder: IWorkspaceFolder,
    ) {
        super(parent, folder.name);
    }
}

export interface ILoadedScriptsPaths {
    readonly workspace: Pick<IWorkspaceContextService, "getWorkspaceFolder" | "getWorkspace">;
    /** The user's home for tildifying the paths outside the workspace. */
    readonly userHome: string;
}

export class RootTreeItem extends BaseTreeItem {
    public constructor(private readonly paths: ILoadedScriptsPaths) {
        super(undefined, "Root");
    }

    public add(session: IDebugSession): SessionTreeItem {
        return this.createIfNeeded(session.getId(), () => new SessionTreeItem(this, session, this.paths));
    }

    public find(session: IDebugSession): SessionTreeItem | undefined {
        return this.getChild(session.getId()) as SessionTreeItem | undefined;
    }
}

export class SessionTreeItem extends BaseTreeItem {
    private readonly map = new Map<string, BaseTreeItem>();

    public constructor(
        parent: BaseTreeItem,
        private readonly session: IDebugSession,
        private readonly paths: ILoadedScriptsPaths,
    ) {
        super(parent, session.getLabel());
    }

    public override getInternalId(): string {
        return this.session.getId();
    }

    public override getSession(): IDebugSession {
        return this.session;
    }

    public override hasChildren(): boolean {
        return true;
    }

    protected override compare(a: BaseTreeItem, b: BaseTreeItem): number {
        const acat = this.category(a);
        const bcat = this.category(b);
        if (acat !== bcat) {
            return acat - bcat;
        }
        return super.compare(a, b);
    }

    private category(item: BaseTreeItem): number {
        // workspace scripts come at the beginning in "folder" order
        if (item instanceof RootFolderTreeItem) {
            return item.folder.index;
        }

        // <...> come at the very end (the item's own label: upstream's `getLabel` does not fold it with its child)
        if (/^<.+>$/u.test(item.getInternalId())) {
            return 1000;
        }

        // everything else in between
        return 999;
    }

    public addPath(source: Source): void {
        let folder: IWorkspaceFolder | null = null;
        let url: string | undefined;

        const rawPath = source.raw.path;
        if (!rawPath) {
            return;
        }
        let path = rawPath;

        // Upstream's label service: a `file:` uri is its path, others stay as they are.
        if (URI_SCHEMA_PATTERN.test(path)) {
            const uri = Uri.parse(path);
            if (uri.scheme === "file") path = uri.fsPath;
        }

        const match = URL_REGEXP.exec(path);
        if (match) {
            url = match[1];
            path = decodeURI(match[2]);
        } else if (isAbsolute(path)) {
            const resource = Uri.file(path);

            // return early if we can resolve a relative path label from the root folder
            folder = this.paths.workspace.getWorkspaceFolder(resource);
            if (folder) {
                // strip off the root folder path
                path = normalize(resource.path.substring(folder.uri.path.length).replace(/^\/+/u, ""));
                const hasMultipleRoots = this.paths.workspace.getWorkspace().folders.length > 1;
                if (hasMultipleRoots) {
                    path = posix.sep + path;
                } else {
                    // don't show root folder
                    folder = null;
                }
            } else {
                // on unix try to tildify absolute paths
                path = tildify(normalize(path), this.paths.userHome);
            }
        }

        let leaf: BaseTreeItem = this;
        path.split(/[/\\]/u).forEach((segment, i) => {
            if (i === 0 && folder) {
                const f = folder;
                leaf = leaf.createIfNeeded(f.name, (parent) => new RootFolderTreeItem(parent, f));
            } else if (i === 0 && url) {
                const u = url;
                leaf = leaf.createIfNeeded(u, (parent) => new BaseTreeItem(parent, u));
            } else {
                leaf = leaf.createIfNeeded(segment, (parent) => new BaseTreeItem(parent, segment));
            }
        });

        leaf.setSource(this.session, source);
        this.map.set(rawPath, leaf);
    }

    public removePath(source: Source): boolean {
        const leaf = source.raw.path ? this.map.get(source.raw.path) : undefined;
        if (leaf) {
            leaf.removeFromParent();
            return true;
        }
        return false;
    }
}

/** Upstream `tildify` on posix. */
function tildify(path: string, userHome: string): string {
    if (userHome && (path === userHome || path.startsWith(`${userHome}/`))) {
        return `~${path.slice(userHome.length)}`;
    }
    return path;
}

export class LoadedScriptsView extends Disposable {
    public readonly tree: LazyTreeControl<BaseTreeItem>;
    private readonly root: RootTreeItem;
    private readonly changeScheduler: RunOnceScheduler;

    public constructor(
        private readonly debugService: IDebugService,
        paths: ILoadedScriptsPaths,
        sources: Pick<IBreakpointSources, "openSource">,
    ) {
        super();
        this.root = new RootTreeItem(paths);
        this.tree = new LazyTreeControl<BaseTreeItem>(
            {
                getRoots: () => this.root.getChildren(),
                getChildren: (element) => element.getChildren(),
                getKey: (element) => element.getId(),
                hasChildren: (element) => element.hasChildren(),
                // Upstream collapses all but the sessions.
                isInitiallyExpanded: (element) => element instanceof SessionTreeItem,
                renderRow: (element): IRowSpan[] => [{ text: element.getLabel() }],
                getLabel: (element) => element.getLabel(),
            },
            { idPrefix: "loadedScripts" },
        );
        this.tree.onActivate = (element) => {
            const source = element.getSource();
            if (source?.available) {
                sources.openSource(source.uri, { sideBySide: false, preserveFocus: false }).catch(onUnexpectedError);
            }
        };

        this.changeScheduler = this.register(
            new RunOnceScheduler(() => {
                this.tree.refresh().catch(onUnexpectedError);
            }, LOADED_SCRIPTS_REFRESH_DELAY_MS),
        );

        const sessionListeners = new Map<string, IDisposable>();
        this.register({
            dispose: () => {
                for (const listener of sessionListeners.values()) listener.dispose();
            },
        });
        const registerSessionListeners = (session: IDebugSession): void => {
            const store = new DisposableStore();
            sessionListeners.set(session.getId(), store);
            store.add(
                session.onDidChangeName(() => {
                    const sessionRoot = this.root.find(session);
                    if (sessionRoot) {
                        sessionRoot.updateLabel(session.getLabel());
                        this.changeScheduler.schedule();
                    }
                }),
            );
            store.add(
                session.onDidLoadedSource((event) => {
                    switch (event.reason) {
                        case "new":
                        case "changed":
                            this.root.add(session).addPath(event.source);
                            this.changeScheduler.schedule();
                            break;
                        case "removed":
                            if (this.root.find(session)?.removePath(event.source)) {
                                this.changeScheduler.schedule();
                            }
                            break;
                    }
                }),
            );
        };

        this.register(debugService.onDidNewSession(registerSessionListeners));
        debugService.getModel().getSessions().forEach(registerSessionListeners);

        this.register(
            debugService.onDidEndSession(({ session }) => {
                sessionListeners.get(session.getId())?.dispose();
                sessionListeners.delete(session.getId());
                this.root.remove(session.getId());
                this.changeScheduler.schedule();
            }),
        );

        // populate tree model with source paths from all debug sessions
        for (const session of debugService.getModel().getSessions()) {
            this.addSourcePathsToSession(session).catch(onUnexpectedError);
        }
    }

    /** Upstream reads the sources of the sessions there are when the view is created; later ones come by events. */
    private async addSourcePathsToSession(session: IDebugSession): Promise<void> {
        if (session.capabilities.supportsLoadedSourcesRequest) {
            const sessionNode = this.root.add(session);
            for (const path of await session.getLoadedSources()) {
                sessionNode.addPath(path);
            }
            this.changeScheduler.schedule();
        }
    }

    public focus(): void {
        this.tree.list.focus();
    }

    public collapseAll(): void {
        this.tree.collapseAll();
    }
}
