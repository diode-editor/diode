import type * as vscode from "vscode";

import { implementsApi } from "./apiSurface.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import { EventEmitter, ExtensionKind, Uri } from "./vscodeTypes.ts";
import { type IWireExtensionDescription, parseWireExtensionActivated, parseWireExtensionCatalog } from "./wireTypes.ts";

/**
 * Only the host knows the catalog: it arrives via the `extensions.catalog` notification
 * (seeded at handshake, since `getExtension` is called already in `activate()`), and `isActive`
 * is completed by the targeted `extensions.activated`. `exports` never goes over the wire: all
 * extensions live in this subprocess.
 */
export interface IExtensionsNamespace {
    readonly extensions: typeof vscode.extensions;
    /** Filled by the subprocess entry point; the namespace only reads it. */
    readonly exportsById: Map<string, unknown>;
    /** Every catalog, not only composition changes: extension roots are indexed from it before activation. */
    readonly onDidReceiveCatalog: vscode.Event<readonly IWireExtensionDescription[]>;
}

/**
 * Intentional: activation is up to the host. An already active extension answers
 * with its `exports`, as upstream — there is nothing to activate.
 */
const ACTIVATE_NOT_IMPLEMENTED =
    "extension.activate() is not implemented in Diode: activation is driven by the host. " +
    "Extensions that are already active return their exports.";

export function createExtensionsNamespace(rpc: SubprocessRpc): IExtensionsNamespace {
    const exportsById = new Map<string, unknown>();
    /**
     * Objects are rebuilt only on a new catalog: `getExtension(id) ===
     * getExtension(id)`, as upstream (we got burned on `activeTextEditor`).
     */
    let known: readonly vscode.Extension<unknown>[] = [];
    let byLowerId = new Map<string, vscode.Extension<unknown>>();
    const activeIds = new Set<string>();
    const changeEmitter = new EventEmitter<void>();
    const catalogEmitter = new EventEmitter<readonly IWireExtensionDescription[]>();

    /** A live view, not a snapshot: an extension may hold the reference and ask later. */
    const toExtension = (description: IWireExtensionDescription): vscode.Extension<unknown> => ({
        id: description.id,
        extensionUri: Uri.file(description.extensionPath),
        extensionPath: description.extensionPath,
        packageJSON: description.packageJSON,
        extensionKind: ExtensionKind.UI,
        get isActive(): boolean {
            return activeIds.has(description.id);
        },
        get exports(): unknown {
            return exportsById.get(description.id);
        },
        activate: (): Thenable<unknown> =>
            activeIds.has(description.id)
                ? Promise.resolve(exportsById.get(description.id))
                : Promise.reject(new Error(ACTIVATE_NOT_IMPLEMENTED)),
    });

    rpc.handleNotification("extensions.catalog", (params) => {
        const parsed = parseWireExtensionCatalog(params);
        if (parsed === null) return;
        const before = known.map((e) => e.id);
        known = parsed.extensions.map(toExtension);
        byLowerId = new Map(known.map((e) => [e.id.toLowerCase(), e]));
        // Plus those already seen activated: the catalog may have arrived before `extensions.activated`.
        for (const description of parsed.extensions) {
            if (description.isActive) activeIds.add(description.id);
        }
        for (const id of [...activeIds]) {
            if (!parsed.extensions.some((d) => d.id === id)) activeIds.delete(id);
        }
        // `onDidChange` is about COMPOSITION (install/uninstall/enable/disable), as
        // upstream; it doesn't fire on activation, so we compare exactly the ids.
        const after = known.map((e) => e.id);
        if (before.length !== after.length || before.some((id, i) => id !== after[i])) changeEmitter.fire();
        catalogEmitter.fire(parsed.extensions);
    });

    rpc.handleNotification("extensions.activated", (params) => {
        const id = parseWireExtensionActivated(params);
        // Stryker disable next-line ConditionalExpression: without the guard `null` itself lands in `activeIds`, and `activeIds.has(<any id>)` doesn't change — the mutant is equivalent, nothing to observe
        if (id === null) return;
        activeIds.add(id);
    });

    const extensions = {
        get all(): readonly vscode.Extension<unknown>[] {
            return known;
        },
        // Id case doesn't matter, as in upstream's `ExtensionIdentifier.equals`.
        getExtension: <T = unknown>(extensionId: string): vscode.Extension<T> | undefined =>
            byLowerId.get(extensionId.toLowerCase()) as vscode.Extension<T> | undefined,
        onDidChange: changeEmitter.event,
    };

    return {
        extensions: implementsApi<typeof vscode.extensions>()(extensions),
        exportsById,
        onDidReceiveCatalog: catalogEmitter.event,
    };
}
