import "./rangeJsonShape.ts";
import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import { type ApiTrace, tracedNamespace } from "./apiTrace.ts";
import type { ExtensionPaths } from "./extensionPaths.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";

/**
 * An overlay over the SHARED namespace rather than a full per-extension factory like
 * upstream's `createApiFactoryAndRegisterActors`: our RPC handlers live inside the
 * namespace factories. Everything except {@link OWNED_MEMBERS} is the same objects
 * (`api1.Position === api2.Position`, getters stay live).
 */

/**
 * The list is explicit: a new "creating" member is added by hand (a test checks
 * `register*Provider` against the shared namespace). Stubs outside the active
 * `vscode.d.ts` surface are not wrapped: there is nothing to own there.
 */
export const OWNED_MEMBERS = {
    window: [
        "createOutputChannel",
        "createStatusBarItem",
        "createTextEditorDecorationType",
        "createTreeView",
        "registerFileDecorationProvider",
        "registerTreeDataProvider",
        "registerUriHandler",
    ],
    languages: [
        "createDiagnosticCollection",
        "createLanguageStatusItem",
        "registerCodeActionsProvider",
        "registerColorProvider",
        "registerCompletionItemProvider",
        "registerDeclarationProvider",
        "registerDefinitionProvider",
        "registerDocumentFormattingEditProvider",
        "registerCallHierarchyProvider",
        "registerDocumentHighlightProvider",
        "registerDocumentRangeFormattingEditProvider",
        "registerDocumentRangeSemanticTokensProvider",
        "registerDocumentSemanticTokensProvider",
        "registerFoldingRangeProvider",
        "registerHoverProvider",
        "registerCodeLensProvider",
        "registerImplementationProvider",
        "registerInlayHintsProvider",
        "registerInlineCompletionItemProvider",
        "registerReferenceProvider",
        "registerRenameProvider",
        "registerSignatureHelpProvider",
        "registerTypeDefinitionProvider",
    ],
    commands: ["registerCommand", "registerTextEditorCommand"],
    // `executeTask` too: the task source and the provider's task id come from the caller.
    tasks: ["registerTaskProvider", "executeTask"],
    workspace: ["registerTaskProvider", "updateWorkspaceFolders"],
} as const satisfies {
    readonly window: readonly (keyof typeof vscode.window)[];
    readonly languages: readonly (keyof typeof vscode.languages)[];
    readonly commands: readonly (keyof typeof vscode.commands)[];
    readonly tasks: readonly (keyof typeof vscode.tasks)[];
    readonly workspace: readonly (keyof typeof vscode.workspace)[];
};

export const VSCODE_ESM_URL = "diode-vscode:api";

export const VSCODE_CJS_CACHE_KEY = "vscode";

export const VSCODE_GLOBAL_KEY_NAME = "diode.vscodeApi";

/**
 * Descriptors, not spread: a getter stays a getter, and own keys match
 * the source, so `Object.keys(vscode)` and `__importStar` see the whole namespace.
 */
function mirror<T extends object>(source: T): T {
    return Object.create(source, Object.getOwnPropertyDescriptors(source)) as T;
}

function ownedNamespace<T extends object>(
    source: T,
    members: readonly (keyof T)[],
    owner: ExtensionOwner,
    id: string,
): T {
    const ns = mirror(source);
    for (const name of members) {
        const fn = source[name] as (...args: unknown[]) => unknown;
        Object.defineProperty(ns, name, {
            value: (...args: unknown[]): unknown => owner.runAs(id, () => Reflect.apply(fn, source, args)),
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
    return ns;
}

export function createExtensionApi(
    shared: typeof vscode,
    owner: ExtensionOwner,
    id: string,
    trace?: ApiTrace,
): typeof vscode {
    const api = mirror(shared);
    Object.defineProperties(api, {
        window: { value: ownedNamespace(shared.window, OWNED_MEMBERS.window, owner, id) },
        languages: { value: ownedNamespace(shared.languages, OWNED_MEMBERS.languages, owner, id) },
        commands: { value: ownedNamespace(shared.commands, OWNED_MEMBERS.commands, owner, id) },
        tasks: { value: ownedNamespace(shared.tasks, OWNED_MEMBERS.tasks, owner, id) },
        workspace: { value: ownedNamespace(shared.workspace, OWNED_MEMBERS.workspace, owner, id) },
    });
    if (trace !== undefined) traceNamespaces(api, id, trace);
    return api;
}

/** Namespaces only: the ESM shim and `__importStar` read every top-level export, so a read there proves nothing. */
function traceNamespaces(api: typeof vscode, id: string, trace: ApiTrace): void {
    for (const [name, value] of Object.entries(api as unknown as Record<string, object>)) {
        if (!/^[a-z]/.test(name) || typeof value !== "object") continue;
        Object.defineProperty(api, name, { value: tracedNamespace(value, name, id, trace) });
    }
}

/** Like upstream's `NodeModuleRequireInterceptor`: values are read from `globalThis` at import time. */
export function buildVscodeEsmShim(exportNames: readonly string[], id?: string): string {
    const names = exportNames.filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && name !== "default");
    const arg = id === undefined ? "" : JSON.stringify(id);
    return [
        `const ns = globalThis[Symbol.for(${JSON.stringify(VSCODE_GLOBAL_KEY_NAME)})](${arg});`,
        ...names.map((name) => `export const ${name} = ns[${JSON.stringify(name)}];`),
    ].join("\n");
}

export interface IExtensionApiFactoryOptions {
    readonly shared: typeof vscode;
    readonly owner: ExtensionOwner;
    readonly paths: ExtensionPaths;
    readonly warn: (message: string) => void;
    /** Absent unless `DIODE_API_TRACE` is set: the overlay then has no tracing wrappers at all. */
    readonly trace?: ApiTrace;
}

/** A module outside known roots gets the shared namespace and one warning per factory lifetime, as upstream. */
export class ExtensionApiFactory {
    private readonly apis = new Map<string, typeof vscode>();
    private warned = false;

    public constructor(private readonly options: IExtensionApiFactoryOptions) {}

    public readonly lookup = (id?: string): typeof vscode => (id === undefined ? this.options.shared : this.forId(id));

    public forPath(file: string | undefined): typeof vscode {
        return this.lookup(this.identify(file));
    }

    public forId(id: string): typeof vscode {
        let api = this.apis.get(id);
        if (api === undefined) {
            api = createExtensionApi(this.options.shared, this.options.owner, id, this.options.trace);
            this.apis.set(id, api);
        }
        return api;
    }

    public cjsModule(parentFilename: string | undefined): { readonly key: string; readonly exports: typeof vscode } {
        const id = this.identify(parentFilename);
        return {
            key: id === undefined ? VSCODE_CJS_CACHE_KEY : `${VSCODE_CJS_CACHE_KEY}:${id}`,
            exports: this.lookup(id),
        };
    }

    public esmUrl(parentURL: string | undefined): string {
        // A non-file importer (`data:`, our own `diode-vscode:`) is not an extension.
        const file = parentURL?.startsWith("file:") === true ? Uri.parse(parentURL).fsPath : undefined;
        const id = this.identify(file, parentURL);
        return id === undefined ? VSCODE_ESM_URL : `${VSCODE_ESM_URL}/${encodeURIComponent(id)}`;
    }

    /** Export names come from the SHARED namespace: it has the full set. */
    public esmSource(url: string): string | undefined {
        const names = Object.keys(this.options.shared);
        if (url === VSCODE_ESM_URL) return buildVscodeEsmShim(names);
        const prefix = `${VSCODE_ESM_URL}/`;
        if (!url.startsWith(prefix)) return undefined;
        return buildVscodeEsmShim(names, decodeURIComponent(url.slice(prefix.length)));
    }

    /** `shown`: how to name the importer in the warning when it isn't a path. */
    private identify(file: string | undefined, shown = file): string | undefined {
        const id = file === undefined ? undefined : this.options.paths.findByPath(file);
        if (id === undefined && !this.warned) {
            this.warned = true;
            this.options.warn(
                `"vscode" imported by a module outside any known extension (${shown ?? "unknown importer"}); ` +
                    "it gets the shared API without extension identity",
            );
        }
        return id;
    }
}
