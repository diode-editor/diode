import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";

export interface IOpenURLOptions {
    /**
     * Не задано или `false` — URL пришёл не из самого продукта, а снаружи, и
     * обработчик вправе спросить человека (как у эталона).
     */
    readonly trusted?: boolean;
    /** Исходная строка, как её ввели (до разбора в {@link Uri}). */
    readonly originalUrl?: string;
}

export interface IURLHandler {
    /** `true` — URL принят этим обработчиком, дальше по цепочке не идёт. */
    handleURL(uri: Uri, options?: IOpenURLOptions): Promise<boolean>;
}

/**
 * Открытие URL продукта (`diode://…`) — аналог `IURLService` эталона: цепочка
 * обработчиков, первый ответивший `true` забирает URL. Источники URL —
 * `Developer: Open URL` (у эталона ещё протокол ОС и `--open-url`).
 */
export interface IURLService {
    open(uri: Uri, options?: IOpenURLOptions): Promise<boolean>;
    registerHandler(handler: IURLHandler): IDisposable;
}

export const URLServiceDIToken = token<IURLService>("URLService");

/** `AbstractURLService` эталона: обработчики по порядку регистрации, до первого `true`. */
export class URLService implements IURLService {
    public static dependencies = [] as const;
    private readonly handlers = new Set<IURLHandler>();

    public async open(uri: Uri, options?: IOpenURLOptions): Promise<boolean> {
        for (const handler of [...this.handlers]) {
            if (await handler.handleURL(uri, options)) return true;
        }
        return false;
    }

    public registerHandler(handler: IURLHandler): IDisposable {
        this.handlers.add(handler);
        return {
            dispose: () => {
                this.handlers.delete(handler);
            },
        };
    }
}
