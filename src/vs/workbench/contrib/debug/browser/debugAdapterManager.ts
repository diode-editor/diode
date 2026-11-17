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
// the extension's factory itself. `contributes.breakpoints` comes through `registerBreakpoints` the same way, and
// `canSetBreakpointsIn` takes the language of the file (upstream: its text model). `guessDebugger` picks a debugger
// for a configuration without a type and for a new launch.json; its picker has no separators, so the first suggested
// debugger carries the hint "suggested", and a debugger is suggested when a session of its type ran in this window
// (upstream also suggests the debuggers of extensions activated at startup). Not here yet, each with its task: the
// launch.json schema and the task labels in it (#1157), the `debug/createConfiguration` menu of extensions. A
// debugger's `when` is evaluated when asked: `debuggersAvailable` follows registrations and every change of a key in
// the `when` of a debugger, as upstream's; `onDidChangeCanSetBreakpoints` follows those and the `when` of the
// breakpoint contributions. `runInTerminal` goes to the core's terminal launcher, not to the adapter
// factory of the debug type (#1142). Deviation: upstream lets a built-in extension's contribution win a key; diode
// has no built-in debuggers.

import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { deserializeWhen, whenKeys } from "../../../../platform/contextkey/common/contextKeyExpr.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { IExtensionService } from "../../../services/extensions/common/extensions.ts";
import { Breakpoints } from "../common/breakpoints.ts";
import type {
    IAdapterManager,
    IBreakpointContribution,
    IConfig,
    IDebugAdapter,
    IDebugAdapterFactory,
    IDebuggerContribution,
    IDebugService,
    IDebugSession,
    IDebugTerminalLauncher,
    IDebugVariableResolver,
    IGuessedDebugger,
} from "../common/debug.ts";
import { Debugger } from "../common/debugger.ts";

/** What guessing a debugger asks of the editor and the user (upstream's editor, language, quick input and dialogs). */
export interface IDebuggerGuessPorts {
    /** The language of the active text editor; `name` is its display name, when it has one. */
    activeLanguage(): { id: string; name: string | undefined } | undefined;
    pick<T extends QuickPickItem>(items: readonly T[], placeholder: string): Promise<T | undefined>;
    confirm(message: string, primaryButton: string): Promise<boolean>;
    /** Upstream's `debug.installAdditionalDebuggers`: the debuggers of the Marketplace, `query` added to the search. */
    installDebuggers(query: string | undefined): void;
}

/** What the adapter manager talks to besides the debug service. */
export interface IAdapterManagerPorts {
    readonly contextKeys: Pick<ContextKeyService, "set" | "evaluate" | "onDidChange">;
    readonly terminalLauncher: IDebugTerminalLauncher;
    readonly extensions: Pick<IExtensionService, "activateByEvent">;
    readonly variables: IDebugVariableResolver;
    /** `debug.allowBreakpointsEverywhere`. */
    readonly allowBreakpointsEverywhere: () => boolean;
    readonly guess: IDebuggerGuessPorts;
}

interface IDebuggerPick extends QuickPickItem {
    readonly pick?: () => IGuessedDebugger | Promise<IGuessedDebugger | undefined>;
}

export class AdapterManager extends Disposable implements IAdapterManager {
    private readonly contributions: IDebuggerContribution[] = [];
    private debuggers: Debugger[] = [];
    /** The context keys the `when` of the debuggers read: a change of one may enable or disable a debugger. */
    private debuggerWhenKeys = new Set<string>();
    private readonly debugAdapterFactories = new Map<string, IDebugAdapterFactory>();
    private readonly onDidRegisterDebuggerEmitter = this.register(new Emitter<void>());
    private readonly usedDebugTypes = new Set<string>();
    // Stryker disable next-line ArrayDeclaration: a non-`Breakpoints` entry has no `language`, it matches no file
    private breakpointContributions: Breakpoints[] = [];
    /** The context keys of the contributions' `when`. */
    private breakpointWhenKeys = new Set<string>();
    private readonly onDidChangeCanSetBreakpointsEmitter = this.register(new Emitter<void>());

    public constructor(
        private readonly debugService: () => IDebugService,
        private readonly ports: IAdapterManagerPorts,
    ) {
        super();
        this.updateContextKeys();
        this.register(
            debugService().onDidNewSession((session) => {
                this.usedDebugTypes.add(session.configuration.type);
            }),
        );
        this.register(
            this.ports.contextKeys.onDidChange((changed) => {
                const keys = [...changed];
                const debuggers = keys.some((key) => this.debuggerWhenKeys.has(key));
                if (debuggers) this.ports.contextKeys.set("debuggersAvailable", this.hasEnabledDebuggers());
                if (debuggers || keys.some((key) => this.breakpointWhenKeys.has(key))) {
                    this.onDidChangeCanSetBreakpointsEmitter.fire();
                }
            }),
        );
    }

    public get onDidRegisterDebugger(): Event<void> {
        return this.onDidRegisterDebuggerEmitter.event;
    }

    /** What `canSetBreakpointsIn` and `hasEnabledDebuggers` answer may have changed (not `debug.*` settings). */
    public get onDidChangeCanSetBreakpoints(): Event<void> {
        return this.onDidChangeCanSetBreakpointsEmitter.event;
    }

    /** Upstream's `breakpointsExtPoint` handler, one `contributes.breakpoints` entry at a time. */
    public registerBreakpoints(contribution: IBreakpointContribution): IDisposable {
        const breakpoints = new Breakpoints(contribution, this.ports.contextKeys);
        this.breakpointContributions.push(breakpoints);
        this.updateBreakpointWhenKeys();
        return {
            dispose: () => {
                this.breakpointContributions = this.breakpointContributions.filter((entry) => entry !== breakpoints);
                this.updateBreakpointWhenKeys();
            },
        };
    }

    private updateBreakpointWhenKeys(): void {
        this.breakpointWhenKeys = new Set(this.breakpointContributions.flatMap((breakpoints) => breakpoints.whenKeys));
        this.onDidChangeCanSetBreakpointsEmitter.fire();
    }

    public canSetBreakpointsIn(languageId: string): boolean {
        if (!languageId || languageId === "jsonc" || languageId === "log") {
            // do not allow breakpoints in our settings files and output
            return false;
        }
        if (this.ports.allowBreakpointsEverywhere()) {
            return true;
        }

        return this.breakpointContributions.some(
            (breakpoints) => breakpoints.language === languageId && breakpoints.enabled,
        );
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
        this.onDidChangeCanSetBreakpointsEmitter.fire();
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

    public getDebuggerLabel(type: string): string | undefined {
        return this.getDebugger(type)?.label;
    }

    public async guessDebugger(gettingConfigurations: boolean): Promise<IGuessedDebugger | undefined> {
        const language = this.ports.guess.activeLanguage();
        let candidates: Debugger[] = [];
        let languageLabel = language?.name;
        if (language) {
            const adapters = this.debuggers.filter((a) => a.enabled && a.interestedInLanguage(language.id));
            if (adapters.length === 1) {
                return { debugger: adapters[0] };
            }
            candidates = adapters;
        }

        // We want to get the debuggers that have configuration providers in the case we are fetching configurations
        // Or if a breakpoint can be set in the current file (good hint that an extension can handle it)
        if (
            (!languageLabel || gettingConfigurations || (language && this.canSetBreakpointsIn(language.id))) &&
            candidates.length === 0
        ) {
            await this.activateDebuggers("onDebugInitialConfigurations");

            candidates = this.debuggers.filter(
                (dbg) =>
                    dbg.enabled &&
                    (dbg.hasInitialConfiguration() ||
                        dbg.hasDynamicConfigurationProviders() ||
                        dbg.hasConfigurationProvider()),
            );
        }

        if (candidates.length === 0 && languageLabel) {
            if (languageLabel.includes(" ")) {
                languageLabel = `'${languageLabel}'`;
            }
            const confirmed = await this.ports.guess.confirm(
                `You don't have an extension for debugging ${languageLabel}. Should we find a ${languageLabel} extension in the Marketplace?`,
                `Find ${languageLabel} extension`,
            );
            if (confirmed) {
                this.ports.guess.installDebuggers(languageLabel);
            }
            return undefined;
        }

        candidates.sort((first, second) => first.label.localeCompare(second.label));
        candidates = candidates.filter((a) => !a.isHiddenFromDropdown);

        const suggestedCandidates = candidates.filter((d) => this.usedDebugTypes.has(d.type));
        const otherCandidates = candidates.filter((d) => !this.usedDebugTypes.has(d.type));

        const picks: IDebuggerPick[] = [];
        const dynamic = await this.debugService().getConfigurationManager().getDynamicProviders();
        const debuggerPick = (c: Debugger): IDebuggerPick => ({ label: c.label, pick: () => ({ debugger: c }) });
        picks.push(...suggestedCandidates.map(debuggerPick));
        if (picks.length > 0) {
            // Upstream's separator "Suggested", on the group's first row.
            picks[0] = { ...picks[0], hint: "suggested" };
        }
        picks.push(...otherCandidates.map(debuggerPick));

        for (const d of dynamic) {
            picks.push({
                label: `More ${d.label} options...`,
                pick: async (): Promise<IGuessedDebugger | undefined> => {
                    const cfg = await d.pick();
                    // A dynamic provider's type has a debugger: its label comes from it.
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    return cfg && { debugger: this.getDebugger(d.type)!, withConfig: cfg };
                },
            });
        }

        picks.push({
            label: languageLabel ? `Install an extension for ${languageLabel}...` : "Install extension...",
        });

        const picked = await this.ports.guess.pick(picks, "Select debugger");
        if (picked?.pick) {
            return await picked.pick();
        }
        if (picked) {
            this.ports.guess.installDebuggers(languageLabel);
        }
        return undefined;
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
