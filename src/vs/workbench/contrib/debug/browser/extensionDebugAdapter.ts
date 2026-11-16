import { DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IWireDebugStartDebugging } from "../../../api/common/debugWireTypes.ts";
import type {
    IExtensionDebugConfigurationProvider,
    IExtensionDebugSink,
} from "../../../api/common/iExtensionDebugSink.ts";
import type {
    IConfig,
    IDebugConfigurationProvider,
    IDebuggerContribution,
    IDebugService,
    IDebugSessionOptions,
} from "../common/debug.ts";
import { isSessionAttach } from "../common/debugUtils.ts";

/**
 * Upstream `MainThreadDebugService` over the debug service: the providers of extensions join the configuration
 * manager, `startDebugging` and `stopDebugging` go to the service. Configurations cross the wire as JSON; the
 * service checks them when it starts a session.
 */
export class ExtensionDebugAdapter implements IExtensionDebugSink {
    public constructor(private readonly getDebugService: () => IDebugService) {}

    private get debugService(): IDebugService {
        return this.getDebugService();
    }

    public registerConfigurationProvider(
        _extensionId: string,
        provider: IExtensionDebugConfigurationProvider,
    ): IDisposable {
        const folder = (uri: Uri | undefined): string | undefined => uri?.toString();
        const core: IDebugConfigurationProvider = { type: provider.type, triggerKind: provider.triggerKind };
        const provide = provider.provideDebugConfigurations?.bind(provider);
        const resolve = provider.resolveDebugConfiguration?.bind(provider);
        const resolve2 = provider.resolveDebugConfigurationWithSubstitutedVariables?.bind(provider);
        if (provide) {
            core.provideDebugConfigurations = async (folderUri, token) =>
                (await provide(folder(folderUri), token)) as IConfig[];
        }
        if (resolve) {
            core.resolveDebugConfiguration = async (folderUri, config, token) =>
                (await resolve(folder(folderUri), config, token)) as IConfig | null | undefined;
        }
        if (resolve2) {
            core.resolveDebugConfigurationWithSubstitutedVariables = async (folderUri, config, token) =>
                (await resolve2(folder(folderUri), config, token)) as IConfig | null | undefined;
        }
        return this.debugService.getConfigurationManager().registerDebugConfigurationProvider(core);
    }

    /** Upstream `$startDebugging`. */
    public startDebugging({ folder, nameOrConfig, options }: IWireDebugStartDebugging): Promise<boolean> {
        const launch = this.debugService.getConfigurationManager().getLaunch(folder ? Uri.parse(folder) : undefined);
        const parentSession = this.debugService.getModel().getSession(options.parentSessionId);
        const saveBeforeStart =
            typeof options.suppressSaveBeforeStart === "boolean" ? !options.suppressSaveBeforeStart : undefined;
        const debugOptions: IDebugSessionOptions = {
            noDebug: options.noDebug,
            parentSession,
            lifecycleManagedByParent: options.lifecycleManagedByParent,
            repl: options.consoleMode === 1 ? "mergeWithParent" : "separate",
            compact: options.compact,
            saveBeforeRestart: saveBeforeStart,
            suppressDebugStatusbar: options.suppressDebugStatusbar,
            suppressDebugToolbar: options.suppressDebugToolbar,
            suppressDebugView: options.suppressDebugView,
        };
        return this.debugService.startDebugging(
            launch,
            nameOrConfig as string | IConfig,
            debugOptions,
            saveBeforeStart,
        );
    }

    /** Upstream `$stopDebugging`. */
    public stopDebugging(sessionId: string | undefined): Promise<void> {
        if (sessionId === undefined) {
            return this.debugService.stopSession(undefined);
        }
        const session = this.debugService.getModel().getSession(sessionId, true);
        if (session) {
            return this.debugService.stopSession(session, isSessionAttach(session));
        }
        return Promise.reject(new Error("debug session not found"));
    }
}

/**
 * Upstream's `debuggers` extension point: the `contributes.debuggers` of every extension become debug types (a
 * contribution without a string `type` is a warning, as upstream's `debugNoType`). Static contributions of the
 * manifests: no activation.
 */
export function bindExtensionDebuggers(
    debugService: IDebugService,
    extensions: readonly IExtension[],
    logger: ILogger,
): IDisposable {
    const store = new DisposableStore();
    const adapterManager = debugService.getAdapterManager();
    for (const extension of extensions) {
        const debuggers = extension.manifest.contributes?.debuggers;
        if (debuggers === undefined) continue;
        if (!Array.isArray(debuggers)) {
            logger.warn(`${extension.id}: 'contributes.debuggers' must be an array.`);
            continue;
        }
        for (const contribution of debuggers as readonly unknown[]) {
            const type = (contribution as { readonly type?: unknown } | null)?.type;
            if (typeof type !== "string" || type === "") {
                logger.warn(`${extension.id}: Debugger 'type' can not be omitted and must be of type 'string'.`);
                continue;
            }
            store.add(adapterManager.registerDebugger(contribution as IDebuggerContribution));
        }
    }
    return store;
}
