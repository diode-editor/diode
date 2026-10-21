import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";

export interface IOpenURLOptions {
    /** Не задано — URL пришёл снаружи, и обработчик вправе спросить человека. */
    readonly trusted?: boolean;
    readonly originalUrl?: string;
}

export interface IURLHandler {
    /** `true` — URL принят этим обработчиком, дальше по цепочке не идёт. */
    handleURL(uri: Uri, options?: IOpenURLOptions): Promise<boolean>;
}

/** Цепочка обработчиков: первый ответивший `true` забирает URL. */
export interface IURLService {
    open(uri: Uri, options?: IOpenURLOptions): Promise<boolean>;
    registerHandler(handler: IURLHandler): IDisposable;
}

export const URLServiceDIToken = token<IURLService>("URLService");

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
