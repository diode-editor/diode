import type { Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { extensionFriendlyName, extensionKey } from "../../../../platform/extensions/common/extensionDependencies.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IOpenURLOptions, IURLHandler } from "../../../../platform/url/common/url.ts";

export const CONFIRMED_URI_HANDLER_EXTENSION_IDS_SETTING = "extensions.confirmedUriHandlerExtensionIds";

/** Upstream `isExtensionId`. */
const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;

const THIRTY_SECONDS = 30 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;

/** Upstream `MainThreadUrls`. */
export interface IExtensionUriHandlers {
    /** Case-insensitive id. */
    has(extensionId: string): boolean;
    handle(extensionId: string, uri: string): Promise<void>;
    /** The id as sent by the subprocess. */
    readonly onDidRegister: Event<string>;
}

export interface IExtensionUrlHandlerOptions {
    readonly handlers: IExtensionUriHandlers;
    activateByEvent(event: string): Promise<void>;
    extensionDisplayName(extensionId: string): string | undefined;
    confirm(message: readonly string[]): Promise<boolean>;
    /** As is: settings.json is edited by hand. */
    confirmedExtensionIds(): unknown;
    notifyNotInstalled(extensionId: string, uri: Uri): void;
    readonly logger: ILogger;
    readonly now?: () => number;
}

/**
 * Upstream `ExtensionUrlHandler`. Deviations: a missing extension isn't installed, the user is
 * told it's not there; there's no "don't ask again" checkbox, trust comes from the setting
 * {@link CONFIRMED_URI_HANDLER_EXTENSION_IDS_SETTING}.
 */
export class ExtensionUrlHandler extends Disposable implements IURLHandler {
    /** Keyed by lowercase id. */
    private uriBuffer = new Map<string, { readonly timestamp: number; readonly uri: Uri }[]>();
    private readonly now: () => number;

    public constructor(private readonly options: IExtensionUrlHandlerOptions) {
        super();
        this.now = options.now ?? Date.now;
        const interval = setInterval(() => {
            this.garbageCollect();
        }, THIRTY_SECONDS);
        this.register({
            dispose: () => {
                clearInterval(interval);
            },
        });
        this.register(
            options.handlers.onDidRegister((extensionId) => {
                this.drain(extensionId);
            }),
        );
    }

    public async handleURL(uri: Uri, options?: IOpenURLOptions): Promise<boolean> {
        if (!EXTENSION_ID.test(uri.authority)) return false;
        const extensionId = uri.authority;
        const key = extensionId.toLowerCase();

        const displayName = this.options.extensionDisplayName(extensionId);
        if (displayName === undefined) {
            this.options.notifyNotInstalled(extensionId, uri);
            return true;
        }

        const trusted = options?.trusted === true || this.isConfirmed(key);
        if (!trusted && !(await this.options.confirm(confirmMessage(displayName, uri)))) return true;

        if (this.options.handlers.has(extensionId)) {
            await this.options.handlers.handle(extensionId, uri.toString());
            return true;
        }

        const uris = this.uriBuffer.get(key) ?? [];
        uris.push({ timestamp: this.now(), uri });
        this.uriBuffer.set(key, uris);
        await this.options.activateByEvent(`onUri:${key}`);
        return true;
    }

    private isConfirmed(key: string): boolean {
        const ids = this.options.confirmedExtensionIds();
        return Array.isArray(ids) && ids.some((id) => typeof id === "string" && id.toLowerCase() === key);
    }

    private drain(extensionId: string): void {
        const key = extensionId.toLowerCase();
        const uris = this.uriBuffer.get(key);
        if (uris === undefined) return;
        this.uriBuffer.delete(key);
        for (const { uri } of uris) {
            this.options.handlers.handle(extensionId, uri.toString()).catch((err: unknown) => {
                this.options.logger.error(`failed to hand buffered uri to extension "${extensionId}"`, err);
            });
        }
    }

    private garbageCollect(): void {
        const now = this.now();
        const next = new Map<string, { readonly timestamp: number; readonly uri: Uri }[]>();
        for (const [key, uris] of this.uriBuffer) {
            const fresh = uris.filter(({ timestamp }) => now - timestamp < FIVE_MINUTES);
            // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent — `drain` handles an empty list in the buffer the same as a missing one: nothing to deliver
            if (fresh.length > 0) next.set(key, fresh);
        }
        this.uriBuffer = next;
    }
}

export function confirmMessage(displayName: string, uri: Uri): string[] {
    const uriString = uri.toString();
    const uriLabel =
        uriString.length > 40
            ? `${uriString.substring(0, 30)}...${uriString.substring(uriString.length - 5)}`
            : uriString;
    return [
        `Allow '${displayName}' extension to open this URI?`,
        uriLabel,
        `To stop asking, add the extension to "${CONFIRMED_URI_HANDLER_EXTENSION_IDS_SETTING}".`,
    ];
}

export function installedExtensionDisplayName(
    extensions: readonly IExtension[],
    extensionId: string,
): string | undefined {
    const key = extensionKey(extensionId);
    const extension = extensions.find((candidate) => extensionKey(candidate.id) === key);
    return extension === undefined ? undefined : extensionFriendlyName(extension.id, extension.manifest);
}
