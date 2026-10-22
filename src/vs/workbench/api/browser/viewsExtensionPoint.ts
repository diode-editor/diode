import type { Event } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import type { IExtension } from "../../../platform/extensions/common/iExtension.ts";
import type {
    IViewContainerContribution,
    IViewContribution,
} from "../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import type { IViewDescriptor, ViewContainerLocation, ViewsService } from "../../browser/parts/views/viewsService.ts";
import type { IViewWelcomeBlock } from "../../browser/parts/views/viewWelcomeElement.ts";

/** Upstream id of an extension's container; the `<id>` part is what `views` keys refer to. */
export const EXTENSION_VIEW_CONTAINER_PREFIX = "workbench.view.extension.";

/** `secondarySidebar` is upstream's key for the auxiliary bar. */
const CONTAINER_LOCATIONS: Readonly<Record<string, ViewContainerLocation>> = {
    activitybar: "sidebar",
    panel: "panel",
    secondarySidebar: "auxiliarybar",
};

/**
 * Upstream `CUSTOM_VIEWS_START_ORDER` and its panel/auxiliary bar counterparts: extension containers go
 * after the built-in ones, in manifest order.
 */
const START_ORDER: Readonly<Record<ViewContainerLocation, number>> = {
    sidebar: 7,
    panel: 6,
    auxiliarybar: 101,
};

/**
 * Built-in containers a `views` key may name. Our ids equal upstream's keys; `debug` and `remote`
 * don't exist here, so their views fall back to Explorer, as upstream does for an unknown key.
 */
const BUILTIN_CONTAINERS: ReadonlySet<string> = new Set(["explorer", "scm"]);
const DEFAULT_CONTAINER = "explorer";

/** Upstream `showCollapsed`: a foreign view in these containers starts collapsed. */
const COLLAPSED_CONTAINERS: ReadonlySet<string> = new Set(["explorer", "scm"]);

/** After the owner's sections (upstream orders a foreign view by its `group` within the container). */
const FOREIGN_VIEW_ORDER = 100;

const CONTAINER_ID_PATTERN = /^[a-z0-9_-]+$/i;

/**
 * Wraps in the narrow sidebar (a plain label would be clipped). The tree is not drawn yet: the
 * section exists so the container, the switcher entry, `<view>.focus` and `onView:` work.
 */
const TREE_PLACEHOLDER: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "Extension tree views are not rendered yet." },
];

/** The slice of `ContextKeyService` a view's `when` needs. */
export interface IViewWhenContext {
    evaluate(when: string): boolean;
    readonly onDidChange: Event<unknown>;
}

export interface IExtensionViewsHost {
    readonly views: ViewsService;
    readonly commands: CommandRegistry;
    readonly contextKeys: IViewWhenContext;
    /** A toast: `<view>.focus` of a webview view says why nothing opens. */
    notify(message: string): void;
    readonly logger?: ILogger;
}

/**
 * Counterpart of upstream `ViewsExtensionHandler` (`viewsExtensionPoint.ts`): `contributes.viewsContainers`
 * become containers (the sidebar ones are listed by the container switcher, our activity bar), and
 * `contributes.views` become their sections. Runs before the workbench mounts, so the containers are
 * built together with the built-in ones and layout restore can return to them.
 *
 * A view with `when` is registered while the clause holds and unregistered when it stops holding
 * (`go.showExplorer`, set by the extension itself through `setContext`), so the container appears and
 * disappears with it, as upstream.
 *
 * Deviations: webview views are not registered (a terminal can't draw them; their `.focus` explains it in
 * a toast), so a container of only webviews stays empty and hidden, as upstream hides an empty one;
 * `visibility: hidden` is not applied yet. The extension set is fixed for the window, so containers are
 * never unregistered; the returned disposable drops the commands and the `when` tracking.
 */
export function registerExtensionViews(extensions: readonly IExtension[], host: IExtensionViewsHost): IDisposable {
    const disposables: IDisposable[] = [];
    const nextOrder = new Map<ViewContainerLocation, number>();
    /** Container id → the extension that contributed it (upstream `ViewContainer.extensionId`). */
    const owners = new Map<string, string>();
    for (const extension of extensions) {
        registerContainers(extension, host, nextOrder, owners, disposables);
    }
    const viewIds = new Set<string>();
    const conditional: IConditionalView[] = [];
    for (const extension of extensions) {
        registerViews(extension, host, owners, viewIds, conditional, disposables);
    }
    if (conditional.length > 0) {
        syncConditionalViews(conditional, host);
        // Changes are coalesced per tick by the service; a handful of clauses is cheap to re-evaluate.
        disposables.push(
            host.contextKeys.onDidChange(() => {
                syncConditionalViews(conditional, host);
            }),
        );
    }
    return {
        dispose: () => {
            for (const disposable of disposables) disposable.dispose();
        },
    };
}

/** Upstream activates `onView:<id>` whenever a view opens, built-in ones included. */
export function bindViewActivation(
    onDidShowView: Event<string>,
    activateByEvent: (event: string) => unknown,
): IDisposable {
    return onDidShowView((viewId) => {
        void activateByEvent(`onView:${viewId}`);
    });
}

interface IConditionalView {
    readonly when: string;
    readonly descriptor: IViewDescriptor;
    shown: boolean;
}

function syncConditionalViews(views: readonly IConditionalView[], host: IExtensionViewsHost): void {
    for (const view of views) {
        const shown = host.contextKeys.evaluate(view.when);
        if (shown === view.shown) continue;
        view.shown = shown;
        if (shown) host.views.registerView(view.descriptor);
        else host.views.unregisterView(view.descriptor.id);
    }
}

function registerContainers(
    extension: IExtension,
    host: IExtensionViewsHost,
    nextOrder: Map<ViewContainerLocation, number>,
    owners: Map<string, string>,
    disposables: IDisposable[],
): void {
    const contributed = extension.manifest.contributes?.viewsContainers;
    if (contributed === undefined) return;
    for (const [key, list] of Object.entries(contributed)) {
        const location = Object.hasOwn(CONTAINER_LOCATIONS, key) ? CONTAINER_LOCATIONS[key] : undefined;
        if (location === undefined) {
            host.logger?.warn(`${extension.id}: views container location "${key}" is not supported, skipped`);
            continue;
        }
        const problem = invalidContainers(list);
        if (problem !== null) {
            host.logger?.error(`${extension.id}: viewsContainers.${key}: ${problem}`);
            continue;
        }
        for (const descriptor of list) {
            const id = `${EXTENSION_VIEW_CONTAINER_PREFIX}${descriptor.id}`;
            if (host.views.getViewContainerLocation(id) !== null) {
                host.logger?.error(`${extension.id}: views container "${descriptor.id}" is already registered`);
                continue;
            }
            const order = nextOrder.get(location) ?? START_ORDER[location];
            nextOrder.set(location, order + 1);
            const title = descriptor.title.trim() === "" ? id : descriptor.title;
            // Upper-case like the built-in titles: upstream shows container titles through `text-transform`.
            host.views.registerContainer({ id, title: title.toUpperCase(), label: title, location, order });
            owners.set(id, extension.id);
            if (host.commands.has(id)) continue;
            disposables.push(
                host.commands.register(
                    id,
                    () => {
                        host.views.openViewContainer(id, true);
                    },
                    `Show ${title}`,
                    undefined,
                    "View",
                ),
            );
        }
    }
}

/** Upstream `isValidViewsContainer`: one bad entry rejects the whole location list. */
function invalidContainers(list: unknown): string | null {
    if (!Array.isArray(list)) return "views containers must be an array";
    for (const descriptor of list as readonly Partial<IViewContainerContribution>[]) {
        if (typeof descriptor.id !== "string" || !CONTAINER_ID_PATTERN.test(descriptor.id)) {
            return "property `id` is mandatory and must be a non-empty string of letters, digits, '_' and '-'";
        }
        if (typeof descriptor.title !== "string") return "property `title` is mandatory and must be a string";
        if (typeof descriptor.icon !== "string") return "property `icon` is mandatory and must be a string";
    }
    return null;
}

function registerViews(
    extension: IExtension,
    host: IExtensionViewsHost,
    owners: ReadonlyMap<string, string>,
    viewIds: Set<string>,
    conditional: IConditionalView[],
    disposables: IDisposable[],
): void {
    const contributed = extension.manifest.contributes?.views;
    if (contributed === undefined) return;
    const owner = ownerName(extension);
    for (const [key, list] of Object.entries(contributed)) {
        if (!Array.isArray(list)) {
            host.logger?.error(`${extension.id}: views.${key}: views must be an array`);
            continue;
        }
        const views = list as readonly Partial<IViewContribution>[];
        // Upstream `isValidViewDescriptors`: a view without an id rejects the whole list.
        if (!views.every(hasId)) {
            host.logger?.error(`${extension.id}: views.${key}: property \`id\` is mandatory and must be a string`);
            continue;
        }
        const containerId = resolveContainer(key, host.views);
        if (containerId === null) {
            host.logger?.warn(
                `${extension.id}: view container "${key}" does not exist, its views are added to Explorer`,
            );
        }
        const target = containerId ?? DEFAULT_CONTAINER;
        const ownContainer = owners.get(target) === extension.id;
        views.forEach((view, index) => {
            const id = view.id;
            const name = typeof view.name === "string" && view.name !== "" ? view.name : id;
            if (viewIds.has(id) || host.views.getViewContainerByViewId(id) !== null) {
                host.logger?.error(`${extension.id}: a view with id "${id}" is already registered`);
                return;
            }
            viewIds.add(id);
            if (view.type === "webview") {
                registerFocusCommand(host, disposables, id, () => {
                    host.notify(`${owner}: view "${name}" is a webview — webviews can't be shown in the terminal`);
                });
                return;
            }
            if (view.type !== undefined && view.type !== "tree") {
                host.logger?.error(`${extension.id}: view "${id}" has unknown type "${view.type}"`);
                return;
            }
            const descriptor: IViewDescriptor = {
                id,
                containerId: target,
                title: name.toUpperCase(),
                order: ownContainer ? index + 1 : FOREIGN_VIEW_ORDER + index,
                body: null,
                placeholder: TREE_PLACEHOLDER,
                collapsed: COLLAPSED_CONTAINERS.has(target) || view.visibility === "collapsed",
                canMoveView: true,
                focus: () => {
                    host.views.focusViewHeader(id);
                },
            };
            if (typeof view.when === "string" && view.when.trim() !== "") {
                // Registered by the first sync, once every view of the batch is known.
                conditional.push({ when: view.when, descriptor, shown: false });
            } else {
                host.views.registerView(descriptor);
            }
            registerFocusCommand(host, disposables, id, () => {
                host.views.openView(id, true);
            });
        });
    }
}

/** Upstream `getViewContainer`; `null` is an unknown key. */
function resolveContainer(key: string, views: ViewsService): string | null {
    if (BUILTIN_CONTAINERS.has(key)) return key;
    const id = `${EXTENSION_VIEW_CONTAINER_PREFIX}${key}`;
    return views.getViewContainerLocation(id) === null ? null : id;
}

/**
 * Upstream has `<view>.focus` for every view, and chat extensions call it before messaging the panel
 * (Supermaven); a missing command would be "command not found" in the extension.
 */
function registerFocusCommand(
    host: IExtensionViewsHost,
    disposables: IDisposable[],
    viewId: string,
    run: () => void,
): void {
    const id = `${viewId}.focus`;
    if (host.commands.has(id)) return;
    disposables.push(host.commands.register(id, run));
}

function hasId(view: Partial<IViewContribution>): view is IViewContribution {
    return typeof view.id === "string" && view.id !== "";
}

function ownerName(extension: IExtension): string {
    const displayName = extension.manifest.displayName;
    return typeof displayName === "string" && displayName !== "" ? displayName : extension.id;
}
