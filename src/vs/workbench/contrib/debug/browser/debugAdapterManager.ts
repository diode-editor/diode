/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugAdapterManager.ts
// The seam extensions plug their debuggers into. Upstream reads the `debuggers` extension point itself; here
// `registerDebugger` takes a contribution, and `contributes.debuggers` of the extensions (`bindExtensionDebuggers`)
// and the tests call it. Contributions of one type merge as upstream's (the first one wins a key, objects merge),
// a `*` contribution merges into every type. The adapters of extensions come through `registerDebugAdapterFactory`
// (upstream's `$registerDebugTypes`); upstream's main-side descriptor factories are not needed, the subprocess asks
// the extension's factory itself. Not here yet, each with its task: `guessDebugger` (#1156), the launch.json schema
// and the task labels in it (#1157),
// `canSetBreakpointsIn` (gutter, #1148). A debugger's `when` is evaluated when asked: `debuggersAvailable` follows
// registrations and every change of a key in the `when` of a debugger, as upstream's. `runInTerminal` goes to the core's terminal launcher, not to the adapter
// factory of the debug type (#1142). Deviation: upstream lets a built-in extension's contribution win a key; diode
// has no built-in debuggers.

import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { deserializeWhen, whenKeys } from "../../../../platform/contextkey/common/contextKeyExpr.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IExtensionService } from "../../../services/extensions/common/extensions.ts";
import type {
    IAdapterManager,
    IConfig,
    IDebugAdapter,
    IDebugAdapterFactory,
    IDebuggerContribution,
    IDebugService,
    IDebugSession,
    IDebugTerminalLauncher,
    IDebugVariableResolver,
} from "../common/debug.ts";
import { Debugger } from "../common/debugger.ts";

/** What the adapter manager talks to besides the debug service. */
export interface IAdapterManagerPorts {
    readonly contextKeys: Pick<ContextKeyService, "set" | "evaluate" | "onDidChange">;
    readonly terminalLauncher: IDebugTerminalLauncher;
    readonly extensions: Pick<IExtensionService, "activateByEvent">;
    readonly variables: IDebugVariableResolver;
}

export class AdapterManager extends Disposable implements IAdapterManager {
    private readonly contributions: IDebuggerContribution[] = [];
    private debuggers: Debugger[] = [];
    /** The context keys the `when` of the debuggers read: a change of one may enable or disable a debugger. */
    private debuggerWhenKeys = new Set<string>();
    private readonly debugAdapterFactories = new Map<string, IDebugAdapterFactory>();
    private readonly onDidRegisterDebuggerEmitter = this.register(new Emitter<void>());

    public constructor(
        private readonly debugService: () => IDebugService,
        private readonly ports: IAdapterManagerPorts,
    ) {
        super();
        this.updateContextKeys();
        this.register(
            this.ports.contextKeys.onDidChange((changed) => {
                if ([...changed].some((key) => this.debuggerWhenKeys.has(key))) {
                    this.ports.contextKeys.set("debuggersAvailable", this.hasEnabledDebuggers());
                }
            }),
        );
    }

    public get onDidRegisterDebugger(): Event<void> {
        return this.onDidRegisterDebuggerEmitter.event;
    }

    public registerDebugger(contribution: IDebuggerContribution): IDisposable {
        this.contributions.push(contribution);
        this.updateDebuggers();
        this.onDidRegisterDebuggerEmitter.fire();
        return {
            dispose: () => {
                const index = this.contributions.indexOf(contribution);
                if (index >= 0) {
                    this.contributions.splice(index, 1);
                    this.updateDebuggers();
                }
            },
        };
    }

    /** Upstream's `debuggersExtPoint` handler over all the contributions at once. */
    private updateDebuggers(): void {
        const merged = new Map<string, IDebuggerContribution>();
        for (const contribution of this.contributions) {
            if (contribution.type === "*") continue;
            // Stryker disable next-line MethodExpression: equivalent, the key only groups the types case-insensitively and any case folding does
            const key = contribution.type.toLowerCase();
            const existing = merged.get(key);
            merged.set(key, existing ? mixin(existing, contribution) : structuredClone(contribution));
        }
        const wildcards = this.contributions.filter((contribution) => contribution.type === "*");
        this.debuggers = [...merged.values()].map(
            (contribution) =>
                new Debugger(
                    this,
                    wildcards.reduce(mixin, contribution),
                    this.debugService,
                    (when) => this.ports.contextKeys.evaluate(when),
                    this.ports.variables,
                ),
        );
        this.debuggerWhenKeys = new Set(
            this.debuggers.flatMap((dbg) => {
                // Stryker disable next-line ConditionalExpression: equivalent, a missing `when` does not parse and gives no expression either
                const when = dbg.when === undefined ? undefined : deserializeWhen(dbg.when);
                // Stryker disable next-line ArrayDeclaration: equivalent, a key of a debugger without `when` is one no context key sets
                return when === undefined ? [] : whenKeys(when);
            }),
        );
        this.updateContextKeys();
    }

    public async activateDebuggers(activationEvent: string, debugType?: string): Promise<void> {
        const promises = [
            this.ports.extensions.activateByEvent(activationEvent),
            this.ports.extensions.activateByEvent("onDebug"),
        ];
        if (debugType) {
            promises.push(this.ports.extensions.activateByEvent(`${activationEvent}:${debugType}`));
        }
        await Promise.all(promises);
    }

    private updateContextKeys(): void {
        this.ports.contextKeys.set("debuggersAvailable", this.hasEnabledDebuggers());
        this.ports.contextKeys.set("debugExtensionAvailable", this.debuggers.length > 0);
    }

    public registerDebugAdapterFactory(debugTypes: string[], debugAdapterLauncher: IDebugAdapterFactory): IDisposable {
        debugTypes.forEach((debugType) => this.debugAdapterFactories.set(debugType, debugAdapterLauncher));
        return {
            dispose: () => {
                debugTypes.forEach((debugType) => this.debugAdapterFactories.delete(debugType));
            },
        };
    }

    public hasEnabledDebuggers(): boolean {
        return this.debuggers.some((dbg) => dbg.enabled);
    }

    public createDebugAdapter(session: IDebugSession): IDebugAdapter | undefined {
        return this.debugAdapterFactories.get(session.configuration.type)?.createDebugAdapter(session);
    }

    public substituteVariables(
        debugType: string,
        folder: IWorkspaceFolder | undefined,
        config: IConfig,
    ): Promise<IConfig> {
        const factory = this.debugAdapterFactories.get(debugType);
        return factory ? factory.substituteVariables(folder, config) : Promise.resolve(config);
    }

    public runInTerminal(
        args: DebugProtocol.RunInTerminalRequestArguments,
        sessionId: string,
    ): Promise<number | undefined> {
        const session = this.debugService().getModel().getSession(sessionId);
        if (!session) {
            return Promise.reject(new Error(`Unknown debug session '${sessionId}'.`));
        }
        return this.ports.terminalLauncher.runInTerminal(args, session);
    }

    public getDebugger(type: string): Debugger | undefined {
        const lower = type.toLowerCase();
        return this.debuggers.find((dbg) => dbg.type.toLowerCase() === lower);
    }
}

/**
 * Upstream's `Debugger.merge` mixin with `overwrite` false: a key the destination has stays, an object merges into
 * the destination's object, a new key is added. Merges into a copy of `destination`.
 */
function mixin(destination: IDebuggerContribution, source: IDebuggerContribution): IDebuggerContribution {
    return mergeObjects(
        structuredClone(destination) as unknown as Record<string, unknown>,
        source,
    ) as unknown as IDebuggerContribution;
}

function mergeObjects(destination: Record<string, unknown>, source: object): Record<string, unknown> {
    for (const [key, value] of Object.entries(source)) {
        if (key === "__proto__") continue;
        const existing = destination[key];
        if (isPlainObject(existing) && isPlainObject(value)) {
            mergeObjects(existing, value);
        } else if (!(key in destination)) {
            destination[key] = structuredClone(value);
        }
    }
    return destination;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
