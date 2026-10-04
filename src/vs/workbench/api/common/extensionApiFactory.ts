import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import type { ExtensionPaths } from "./extensionPaths.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";

/**
 * Своё `vscode` у каждого расширения — тонкий оверлей поверх ОБЩЕГО namespace.
 *
 * Эталон собирает API на расширение целиком (`createApiFactoryAndRegisterActors`):
 * у него сервисы вынесены, и каждый член — однострочник с `extension`. У нас
 * обработчики RPC живут внутри фабрик неймспейсов, поэтому полная фабрика на
 * расширение — сознательно НЕ наш путь. Оверлей делает минимум: знает id
 * расширения и на время синхронных «создающих» вызовов ({@link OWNED_MEMBERS})
 * выставляет окружающего владельца ({@link ExtensionOwner.runAs}). Всё остальное
 * — те же объекты, что у общего namespace: `api1.Position === api2.Position`,
 * геттеры (`window.activeTextEditor`) живые.
 */

/**
 * Синхронные члены, создающие что-то от имени расширения: id канала/пункта,
 * владелец регистрации провайдера или команды. Только их оверлей оборачивает в
 * `runAs`; список явный — новый «создающий» член добавляется сюда руками
 * (тест сверяет `register*Provider` с общим namespace). Заглушки
 * `register*Provider` вне активной поверхности `vscode.d.ts` (no-op, ничего не
 * регистрируют) не оборачиваются: владеть там нечем.
 */
export const OWNED_MEMBERS = {
    window: [
        "createOutputChannel",
        "createStatusBarItem",
        "createTextEditorDecorationType",
        "registerFileDecorationProvider",
    ],
    languages: [
        "createDiagnosticCollection",
        "createLanguageStatusItem",
        "registerCodeActionsProvider",
        "registerCompletionItemProvider",
        "registerDefinitionProvider",
        "registerDocumentFormattingEditProvider",
        "registerDocumentRangeFormattingEditProvider",
        "registerFoldingRangeProvider",
        "registerHoverProvider",
        "registerInlineCompletionItemProvider",
        "registerReferenceProvider",
        "registerRenameProvider",
        "registerSignatureHelpProvider",
    ],
    commands: ["registerCommand", "registerTextEditorCommand"],
} as const satisfies {
    readonly window: readonly (keyof typeof vscode.window)[];
    readonly languages: readonly (keyof typeof vscode.languages)[];
    readonly commands: readonly (keyof typeof vscode.commands)[];
};

/** URL виртуального ESM-модуля `"vscode"` без владельца (общий namespace). */
export const VSCODE_ESM_URL = "diode-vscode:api";

/** Ключ `Module._cache` для `require("vscode")` без владельца. */
export const VSCODE_CJS_CACHE_KEY = "vscode";

/**
 * Ключ, под которым ESM-шим достаёт API из `globalThis`: там лежит функция
 * `(id?) => typeof vscode` ({@link ExtensionApiFactory.lookup}).
 */
export const VSCODE_GLOBAL_KEY_NAME = "diode.vscodeApi";

/**
 * Копия объекта, делегирующая исходнику: прототип — сам исходник, собственные
 * свойства — его ДЕСКРИПТОРЫ (не значения). Дескрипторы, а не spread: геттер
 * остаётся геттером (`activeTextEditor` живой), а собственные ключи совпадают с
 * исходником — `Object.keys(vscode)` и `__importStar` из TS-сборки расширения
 * видят весь namespace, а не одни перекрытые члены.
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

/** Оверлей общего namespace для расширения `id` (см. шапку модуля). */
export function createExtensionApi(shared: typeof vscode, owner: ExtensionOwner, id: string): typeof vscode {
    const api = mirror(shared);
    Object.defineProperties(api, {
        window: { value: ownedNamespace(shared.window, OWNED_MEMBERS.window, owner, id) },
        languages: { value: ownedNamespace(shared.languages, OWNED_MEMBERS.languages, owner, id) },
        commands: { value: ownedNamespace(shared.commands, OWNED_MEMBERS.commands, owner, id) },
    });
    return api;
}

/**
 * Собирает исходник виртуального ESM-модуля `"vscode"`: по именованному export'у
 * на каждый член namespace'а, значения берутся из `globalThis` в момент import'а
 * — API расширения `id` (без `id` — общий namespace).
 *
 * Так же устроен эталон (`NodeModuleRequireInterceptor` в
 * `extHostExtensionService.ts`): сгенерированный модуль реэкспортирует члены
 * живого объекта API. Реэкспортировать можно только то, что является валидным
 * JS-идентификатором, — других имён в `vscode.d.ts` и не бывает.
 */
export function buildVscodeEsmShim(exportNames: readonly string[], id?: string): string {
    const names = exportNames.filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && name !== "default");
    const arg = id === undefined ? "" : JSON.stringify(id);
    return [
        `const ns = globalThis[Symbol.for(${JSON.stringify(VSCODE_GLOBAL_KEY_NAME)})](${arg});`,
        ...names.map((name) => `export const ${name} = ns[${JSON.stringify(name)}];`),
    ].join("\n");
}

export interface IExtensionApiFactoryOptions {
    /** Общий namespace — один на субпроцесс. */
    readonly shared: typeof vscode;
    readonly owner: ExtensionOwner;
    /** Индекс корней расширений; наполняет точка входа субпроцесса. */
    readonly paths: ExtensionPaths;
    /** Куда сказать про модуль без расширения (один раз за жизнь фабрики). */
    readonly warn: (message: string) => void;
}

/**
 * Раздача `vscode` по модулю-импортёру: CJS — по `parent.filename`, ESM — по
 * `context.parentURL`. API расширения создаётся лениво и кэшируется по id;
 * модуль вне известных корней получает общий namespace (как до оверлеев) и
 * одно предупреждение на всю жизнь фабрики — по образцу эталона.
 */
export class ExtensionApiFactory {
    private readonly apis = new Map<string, typeof vscode>();
    private warned = false;

    public constructor(private readonly options: IExtensionApiFactoryOptions) {}

    /** Функция для ESM-шима в `globalThis`: `(id?) => typeof vscode`. */
    public readonly lookup = (id?: string): typeof vscode => (id === undefined ? this.options.shared : this.forId(id));

    /** API для модуля, лежащего по `file` (`undefined` — импортёр неизвестен). */
    public forPath(file: string | undefined): typeof vscode {
        return this.lookup(this.identify(file));
    }

    /** API расширения `id` — один объект на id. */
    public forId(id: string): typeof vscode {
        let api = this.apis.get(id);
        if (api === undefined) {
            api = createExtensionApi(this.options.shared, this.options.owner, id);
            this.apis.set(id, api);
        }
        return api;
    }

    /**
     * CJS: ключ `Module._cache` для `require("vscode")` из модуля `parentFilename`
     * и объект, который под ним должен лежать.
     */
    public cjsModule(parentFilename: string | undefined): { readonly key: string; readonly exports: typeof vscode } {
        const id = this.identify(parentFilename);
        return {
            key: id === undefined ? VSCODE_CJS_CACHE_KEY : `${VSCODE_CJS_CACHE_KEY}:${id}`,
            exports: this.lookup(id),
        };
    }

    /** ESM: URL виртуального модуля `"vscode"` для импортёра `parentURL`. */
    public esmUrl(parentURL: string | undefined): string {
        // Не-файловый импортёр (`data:`, наш же `diode-vscode:`) — не расширение.
        const file = parentURL?.startsWith("file:") === true ? Uri.parse(parentURL).fsPath : undefined;
        const id = this.identify(file, parentURL);
        return id === undefined ? VSCODE_ESM_URL : `${VSCODE_ESM_URL}/${encodeURIComponent(id)}`;
    }

    /**
     * ESM: исходник модуля по URL из {@link esmUrl}; `undefined` — URL не наш.
     * Имена export'ов — из ОБЩЕГО namespace (у него полный состав).
     */
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
