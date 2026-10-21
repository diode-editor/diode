import * as path from "node:path";

export interface IExtensionEntry {
    activate(context: { readonly subscriptions: { dispose(): unknown }[] }): unknown;
    deactivate?(): unknown;
}

/** Ровно одно из `mainPath` и `source`: builtin приходит исходником, под SEA файла на ФС нет. */
export interface IExtensionRegistration {
    readonly id: string;
    readonly manifest: {
        readonly name: string;
        readonly publisher: string;
        readonly version: string;
        readonly [key: string]: unknown;
    };
    readonly mainPath?: string;
    /** Без него (builtin из `source`) корнем считается каталог `filename`. */
    readonly extensionPath?: string;
    readonly source?: string;
    readonly filename?: string;
    /** Регистрирует расширение одноимённую команду — host заводит прокси с этим title для палитры. */
    readonly commandTitles?: Readonly<Record<string, string>>;
    /** Категория — префикс подписи только в палитре: в заголовке протекла бы в меню и статус-бар. */
    readonly commandCategories?: Readonly<Record<string, string>>;
    /** Пусто или нет — трактуется как `["*"]` (eager). */
    readonly activationEvents?: readonly string[];
}

/** Одно правило на обе стороны RPC. У builtin'а из `source` — каталог синтетического `filename`, «в бандл». */
export function extensionRootPath(spec: {
    readonly extensionPath?: string;
    readonly mainPath?: string;
    readonly filename?: string;
}): string {
    /* v8 ignore next -- одно из двух есть всегда: без mainPath и без filename расширение не загрузилось бы */
    // Stryker disable next-line StringLiteral: хвостовой `?? ""` недостижим по тому же инварианту, что и v8 ignore выше — тронуть его мутантом нечем
    return spec.extensionPath ?? path.dirname(spec.mainPath ?? spec.filename ?? "");
}
