import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";

export interface IOpenURLOptions {
    /** Unset means the URL came from outside, and the handler may ask the user. */
    readonly trusted?: boolean;
    readonly originalUrl?: string;
}

export interface IURLHandler {
    /** `true` means this handler took the URL and it goes no further down the chain. */
    handleURL(uri: Uri, options?: IOpenURLOptions): Promise<boolean>;
}

/** A chain of handlers: the first to answer `true` takes the URL. */
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
