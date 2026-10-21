import type * as vscode from "vscode";

import { implementsApi } from "./apiSurface.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import { EventEmitter, ExtensionKind, Uri } from "./vscodeTypes.ts";
import { type IWireExtensionDescription, parseWireExtensionActivated, parseWireExtensionCatalog } from "./wireTypes.ts";

/**
 * Каталог знает только хост: он приезжает уведомлением `extensions.catalog`
 * (семя на handshake — `getExtension` зовут уже в `activate()`), `isActive`
 * доводит точечный `extensions.activated`. `exports` по проводу не ездит: все
 * расширения живут в этом субпроцессе.
 */
export interface IExtensionsNamespace {
    readonly extensions: typeof vscode.extensions;
    /** Наполняет точка входа субпроцесса; namespace только читает. */
    readonly exportsById: Map<string, unknown>;
    /** Каждый каталог, а не только смена состава: по нему корни расширений индексируются до активации. */
    readonly onDidReceiveCatalog: vscode.Event<readonly IWireExtensionDescription[]>;
}

/**
 * Осознанно: активацией распоряжается хост. Уже активное расширение отвечает
 * своим `exports`, как в эталоне, — активировать нечего.
 */
const ACTIVATE_NOT_IMPLEMENTED =
    "extension.activate() is not implemented in Diode: activation is driven by the host. " +
    "Extensions that are already active return their exports.";

export function createExtensionsNamespace(rpc: SubprocessRpc): IExtensionsNamespace {
    const exportsById = new Map<string, unknown>();
    /**
     * Объекты пересобираются только на новом каталоге: `getExtension(id) ===
     * getExtension(id)`, как в эталоне (обжигались на `activeTextEditor`).
     */
    let known: readonly vscode.Extension<unknown>[] = [];
    let byLowerId = new Map<string, vscode.Extension<unknown>>();
    const activeIds = new Set<string>();
    const changeEmitter = new EventEmitter<void>();
    const catalogEmitter = new EventEmitter<readonly IWireExtensionDescription[]>();

    /** Живой вид, а не снимок: расширение вправе держать ссылку и спросить позже. */
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
        // Плюс уже виденные ожившими: каталог мог уехать раньше `extensions.activated`.
        for (const description of parsed.extensions) {
            if (description.isActive) activeIds.add(description.id);
        }
        for (const id of [...activeIds]) {
            if (!parsed.extensions.some((d) => d.id === id)) activeIds.delete(id);
        }
        // `onDidChange` — про СОСТАВ (install/uninstall/enable/disable), как в
        // эталоне; на активацию он не стреляет, поэтому сравниваем именно id.
        const after = known.map((e) => e.id);
        if (before.length !== after.length || before.some((id, i) => id !== after[i])) changeEmitter.fire();
        catalogEmitter.fire(parsed.extensions);
    });

    rpc.handleNotification("extensions.activated", (params) => {
        const id = parseWireExtensionActivated(params);
        // Stryker disable next-line ConditionalExpression: снятый guard кладёт в `activeIds` сам `null`, а с ним `activeIds.has(<любой id>)` не меняется — мутант эквивалентен, наблюдать нечего
        if (id === null) return;
        activeIds.add(id);
    });

    const extensions = {
        get all(): readonly vscode.Extension<unknown>[] {
            return known;
        },
        // Регистр id не важен, как в `ExtensionIdentifier.equals` эталона.
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
