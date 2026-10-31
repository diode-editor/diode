import { DisposableMap, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { withCursorChangeSource } from "../../../../../editor/common/core/cursorChangeSource.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import { type IProductIconService, NERD_FONT_ICONS } from "../../../../../platform/theme/common/productIconService.ts";
import type { ICommandService } from "../../../../api/common/iCommandService.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

export interface ICommandPaletteMetadata {
    readonly commandTitles?: Readonly<Record<string, string>>;
    readonly commandCategories?: Readonly<Record<string, string>>;
}

/**
 * Subprocess command proxies live for one spawn. `onCommand:<id>` stubs and palette labels live with the host:
 * the command is visible and executable by id before the extension activates and after the subprocess dies.
 */
export class CommandsCustomer implements IExtensionHostCustomer {
    private proxies: DisposableMap<string> | null = null;
    /** Stand IN PLACE of proxies before activation: executing first brings up the extension. */
    private readonly activationStubs = new DisposableMap<string>();
    private readonly titles = new Map<string, string>();
    private readonly categories = new Map<string, string>();

    public constructor(
        private readonly commandService: ICommandService,
        private readonly activate: (event: string) => Promise<void>,
        private readonly logger: ILogger | undefined,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {}

    /**
     * Icons are expanded here: upstream the command label is a quick pick label where icons
     * render, while for us the manifest text becomes the command palette item label.
     */
    public addPaletteMetadata(metadata: ICommandPaletteMetadata): void {
        for (const [id, title] of Object.entries(metadata.commandTitles ?? {})) {
            this.titles.set(id, this.icons.renderCodicons(title));
        }
        for (const [id, category] of Object.entries(metadata.commandCategories ?? {})) {
            this.categories.set(id, this.icons.renderCodicons(category));
        }
    }

    /**
     * Without waiting for activation the command wouldn't be found: the subprocess itself registers the real proxy.
     * A live proxy is never overwritten by a stub.
     */
    public arm(id: string): void {
        if (this.proxies?.has(id) === true || this.activationStubs.has(id)) return;
        const event = `onCommand:${id}`;
        this.activationStubs.set(
            id,
            this.commandService.registerProxy(
                id,
                async (args): Promise<unknown> => {
                    try {
                        await this.activate(event);
                    } catch (err) {
                        // Callers (palette, keybinding) don't await the result — a reject would end up
                        // in the main process unhandledRejection.
                        this.logger?.error(`failed to activate extension for command "${id}"`, err);
                        return undefined;
                    }
                    // The extension came up but didn't register the command — calling again through
                    // the stub would loop.
                    if (this.proxies?.has(id) !== true) {
                        this.logger?.warn(`command "${id}" is still unregistered after activation`);
                        return undefined;
                    }
                    return this.commandService.execute(id, args);
                },
                this.titles.get(id),
                this.categories.get(id),
            ),
        );
    }

    public disarm(id: string): void {
        this.activationStubs.deleteAndDispose(id);
    }

    /** Stubs live in the SHARED core registry — after shutdown it would hold entries with nothing to bring up. */
    public disarmAll(): void {
        this.activationStubs.clearAndDisposeAll();
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const proxies = store.add(new DisposableMap<string>());
        this.proxies = proxies;
        // A core handler may return a value or a thenable.
        store.add(
            rpc.handleRequest("commands.executeCommand", (params): unknown => {
                const { id, args } = parseCommandInvocation(params);
                // A cursor moved by the command arrives as `TextEditorSelectionChangeKind.Command`; the scope
                // is synchronous — after await `kind === undefined` (see cursorChangeSource.ts).
                return Promise.resolve(withCursorChangeSource("command", () => this.commandService.execute(id, args)));
            }),
        );
        store.add(rpc.handleRequest("commands.getCommands", () => this.commandService.listCommandIds()));
        store.add(
            rpc.handleNotification("commands.registerCommand", (params): void => {
                const id = parseCommandId(params);
                if (id === null) return;
                this.disarm(id);
                // Re-registering an id: `set` disposes the previous proxy only after the new one is registered —
                // the registry removes the entry only if it still points to the handler being disposed.
                proxies.set(
                    id,
                    this.commandService.registerProxy(
                        id,
                        (args) => rpc.request("commands.executeCommand", { id, args }),
                        this.titles.get(id),
                        this.categories.get(id),
                    ),
                );
            }),
        );
        store.add(
            rpc.handleNotification("commands.unregisterCommand", (params): void => {
                const id = parseCommandId(params);
                // Stryker disable next-line ConditionalExpression: equivalent — removing a missing key (`null`) from the proxy map does nothing; the early return is only for the type
                if (id === null) return;
                proxies.deleteAndDispose(id);
            }),
        );
        store.add({
            // Stryker disable next-line BlockStatement: hygiene — the gone spawn's map was already emptied by its store (DisposableMap disposes everything), `has` on it is false anyway; we drop the reference so as not to hold a dead map
            dispose: () => {
                this.proxies = null;
            },
        });
        return store;
    }
}

function parseCommandInvocation(raw: unknown): { id: string; args: unknown[] } {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("commands.executeCommand: params must be an object");
    }
    const obj = raw as { id?: unknown; args?: unknown };
    if (typeof obj.id !== "string" || obj.id === "") {
        throw new Error("commands.executeCommand: id must be a non-empty string");
    }
    const args = Array.isArray(obj.args) ? (obj.args as unknown[]) : [];
    return { id: obj.id, args };
}

function parseCommandId(raw: unknown): string | null {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: without the check, reading `.id` below filters out primitives, while `null`/`undefined` throws on it — RpcEndpoint swallows the notification exception, the observable result is the same “ignored”
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as { id?: unknown };
    return typeof obj.id === "string" && obj.id !== "" ? obj.id : null;
}
