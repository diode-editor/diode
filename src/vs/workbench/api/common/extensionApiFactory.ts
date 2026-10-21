import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import type { ExtensionPaths } from "./extensionPaths.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";

/**
 * Оверлей поверх ОБЩЕГО namespace, а не полная фабрика на расширение, как
 * `createApiFactoryAndRegisterActors` эталона: у нас обработчики RPC живут внутри
 * фабрик неймспейсов. Всё, кроме {@link OWNED_MEMBERS}, — те же объекты
 * (`api1.Position === api2.Position`, геттеры живые).
 */

/**
 * Список явный: новый «создающий» член добавляется руками (тест сверяет
 * `register*Provider` с общим namespace). Заглушки вне активной поверхности
 * `vscode.d.ts` не оборачиваются: владеть там нечем.
 */
export const OWNED_MEMBERS = {
    window: [
        "createOutputChannel",
        "createStatusBarItem",
        "createTextEditorDecorationType",
        "registerFileDecorationProvider",
        "registerUriHandler",
    ],
    languages: [
        "createDiagnosticCollection",
        "createLanguageStatusItem",
        "registerCodeActionsProvider",
        "registerCompletionItemProvider",
        "registerDefinitionProvider",
        "registerDocumentFormattingEditProvider",
        "registerDocumentRangeFormattingEditProvider",
        "registerDocumentRangeSemanticTokensProvider",
        "registerDocumentSemanticTokensProvider",
        "registerFoldingRangeProvider",
        "registerHoverProvider",
        "registerInlineCompletionItemProvider",
        "registerReferenceProvider",
        "registerRenameProvider",
        "registerSignatureHelpProvider",
    ],
    commands: ["registerCommand", "registerTextEditorCommand"],
    // `executeTask` тоже: источник задачи и id задачи провайдера — по вызывающему.
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
 * Дескрипторы, а не spread: геттер остаётся геттером, а собственные ключи
 * совпадают с исходником — `Object.keys(vscode)` и `__importStar` видят весь namespace.
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

export function createExtensionApi(shared: typeof vscode, owner: ExtensionOwner, id: string): typeof vscode {
    const api = mirror(shared);
    Object.defineProperties(api, {
        window: { value: ownedNamespace(shared.window, OWNED_MEMBERS.window, owner, id) },
        languages: { value: ownedNamespace(shared.languages, OWNED_MEMBERS.languages, owner, id) },
        commands: { value: ownedNamespace(shared.commands, OWNED_MEMBERS.commands, owner, id) },
        tasks: { value: ownedNamespace(shared.tasks, OWNED_MEMBERS.tasks, owner, id) },
        workspace: { value: ownedNamespace(shared.workspace, OWNED_MEMBERS.workspace, owner, id) },
    });
    return api;
}

/** Как `NodeModuleRequireInterceptor` эталона: значения берутся из `globalThis` в момент import'а. */
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
}

/** Модуль вне известных корней получает общий namespace и одно предупреждение на жизнь фабрики, как в эталоне. */
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
            api = createExtensionApi(this.options.shared, this.options.owner, id);
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
        // Не-файловый импортёр (`data:`, наш же `diode-vscode:`) — не расширение.
        const file = parentURL?.startsWith("file:") === true ? Uri.parse(parentURL).fsPath : undefined;
        const id = this.identify(file, parentURL);
        return id === undefined ? VSCODE_ESM_URL : `${VSCODE_ESM_URL}/${encodeURIComponent(id)}`;
    }

    /** Имена export'ов — из ОБЩЕГО namespace: у него полный состав. */
    public esmSource(url: string): string | undefined {
        const names = Object.keys(this.options.shared);
        if (url === VSCODE_ESM_URL) return buildVscodeEsmShim(names);
        const prefix = `${VSCODE_ESM_URL}/`;
        if (!url.startsWith(prefix)) return undefined;
        return buildVscodeEsmShim(names, decodeURIComponent(url.slice(prefix.length)));
    }

    /** `shown` — как назвать импортёра в предупреждении, если это не путь. */
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
