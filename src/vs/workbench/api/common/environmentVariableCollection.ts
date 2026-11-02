import type * as vscode from "vscode";

import { Emitter, type Event } from "../../../base/common/event.ts";
import type {
    EnvironmentVariableMutatorType as WireMutatorType,
    IEnvironmentVariableCollectionDescription,
    IEnvironmentVariableMutator,
    IEnvironmentVariableScope,
} from "../../../platform/terminal/common/environmentVariable.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { EnvironmentVariableMutatorType } from "./vscodeTypes.ts";
import { parseWireEnvironmentVariableCollections } from "./wireTypes.ts";

type ScopedCollection = vscode.GlobalEnvironmentVariableCollection;

/**
 * An extension's collection outlives its activation; every change is sent
 * to the host in full right away, so the very next terminal is created with it.
 */
export class ExtHostEnvironmentVariableCollections {
    private readonly collections = new Map<string, UnifiedEnvironmentVariableCollection>();

    public constructor(private readonly rpc: SubprocessRpc) {
        rpc.handleNotification("terminal.initEnvironmentVariableCollections", (params) => {
            for (const [extensionId, entries] of parseWireEnvironmentVariableCollections(params)) {
                this.set(extensionId, new UnifiedEnvironmentVariableCollection(entries));
            }
        });
    }

    public get(extensionId: string): ScopedCollection {
        let collection = this.collections.get(extensionId);
        if (collection === undefined) {
            collection = new UnifiedEnvironmentVariableCollection();
            this.set(extensionId, collection);
        }
        return collection.getScoped(undefined);
    }

    private set(extensionId: string, collection: UnifiedEnvironmentVariableCollection): void {
        this.collections.set(extensionId, collection);
        collection.onDidChange(() => {
            const entries = [...collection.map.entries()];
            this.rpc.notify("terminal.setEnvironmentVariableCollection", {
                extensionId,
                persistent: collection.persistent,
                ...(entries.length === 0 ? {} : { collection: entries }),
                description: [...collection.descriptionMap.entries()],
            });
        });
    }
}

function scopeKey(scope: vscode.EnvironmentVariableScope | undefined): string {
    return scope?.workspaceFolder?.uri.toString() ?? "";
}

function mutatorKey(variable: string, scope: vscode.EnvironmentVariableScope | undefined): string {
    const key = scopeKey(scope);
    return key === "" ? variable : `${variable}:::${key}`;
}

/** A folder without a `Uri`: only `index` is applied for it. */
function toWireScope(scope: vscode.EnvironmentVariableScope | undefined): IEnvironmentVariableScope | undefined {
    // Without a folder the scoped collection is the global one itself (`getScoped({})` returns it).
    const folder = scope?.workspaceFolder;
    return folder === undefined
        ? undefined
        : { workspaceFolder: { uri: folder.uri.toString(), name: folder.name, index: folder.index } };
}

/** Like upstream's `convertMutator`. A copy of the options: the extension must not edit the stored mutator. */
function toApiMutator(mutator: IEnvironmentVariableMutator): vscode.EnvironmentVariableMutator {
    return {
        type: mutator.type as unknown as vscode.EnvironmentVariableMutatorType,
        value: mutator.value,
        options: { ...mutator.options },
    };
}

class UnifiedEnvironmentVariableCollection {
    public readonly map: Map<string, IEnvironmentVariableMutator>;
    public readonly descriptionMap = new Map<string, IEnvironmentVariableCollectionDescription>();
    private readonly scoped = new Map<string, ScopedCollection>();
    private persistentValue = true;
    private readonly onDidChangeEmitter = new Emitter<void>();
    public readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    public constructor(entries: readonly (readonly [string, IEnvironmentVariableMutator])[] = []) {
        this.map = new Map(entries);
    }

    public get persistent(): boolean {
        return this.persistentValue;
    }

    public set persistent(value: boolean) {
        this.persistentValue = value;
        this.onDidChangeEmitter.fire();
    }

    public getScoped(scope: vscode.EnvironmentVariableScope | undefined): ScopedCollection {
        const key = scopeKey(scope);
        let collection = this.scoped.get(key);
        if (collection === undefined) {
            collection = this.createScoped(scope);
            this.scoped.set(key, collection);
        }
        return collection;
    }

    public setMutator(
        variable: string,
        value: string,
        type: EnvironmentVariableMutatorType,
        options: vscode.EnvironmentVariableMutatorOptions | undefined,
        scope: vscode.EnvironmentVariableScope | undefined,
    ): void {
        if (options?.applyAtProcessCreation === false && options.applyAtShellIntegration !== true) {
            throw new Error(
                "EnvironmentVariableMutatorOptions must apply at either process creation or shell integration",
            );
        }
        const key = mutatorKey(variable, scope);
        const current = this.map.get(key);
        const newOptions =
            options === undefined
                ? { applyAtProcessCreation: true }
                : {
                      applyAtProcessCreation: options.applyAtProcessCreation ?? false,
                      applyAtShellIntegration: options.applyAtShellIntegration ?? false,
                  };
        if (
            current?.value === value &&
            (current.type as number) === (type as number) &&
            // Stryker disable next-line OptionalChaining: equivalent — every mutator has options (own ones via `newOptions`; for the seed the wire parser always puts an object)
            current.options?.applyAtProcessCreation === newOptions.applyAtProcessCreation &&
            current.options.applyAtShellIntegration === newOptions.applyAtShellIntegration &&
            // Stryker disable next-line OptionalChaining,ConditionalExpression: equivalent — for the key `<variable>:::<uri>` the current and new mutators either both have a folder or both don't, and the scoped collection is cached by uri together with the folder of the first call, so their index is the same
            current.scope?.workspaceFolder?.index === scope?.workspaceFolder?.index
        ) {
            return;
        }
        const wireScope = toWireScope(scope);
        this.map.set(key, {
            variable,
            value,
            type: type as unknown as WireMutatorType,
            options: newOptions,
            ...(wireScope === undefined ? {} : { scope: wireScope }),
        });
        this.onDidChangeEmitter.fire();
    }

    public get(
        variable: string,
        scope: vscode.EnvironmentVariableScope | undefined,
    ): vscode.EnvironmentVariableMutator | undefined {
        const mutator = this.map.get(mutatorKey(variable, scope));
        return mutator === undefined ? undefined : toApiMutator(mutator);
    }

    public variableMap(
        scope: vscode.EnvironmentVariableScope | undefined,
    ): Map<string, vscode.EnvironmentVariableMutator> {
        const key = scopeKey(scope);
        const result = new Map<string, vscode.EnvironmentVariableMutator>();
        for (const mutator of this.map.values()) {
            if ((mutator.scope?.workspaceFolder?.uri ?? "") === key)
                result.set(mutator.variable, toApiMutator(mutator));
        }
        return result;
    }

    public delete(variable: string, scope: vscode.EnvironmentVariableScope | undefined): void {
        this.map.delete(mutatorKey(variable, scope));
        this.onDidChangeEmitter.fire();
    }

    public clear(scope: vscode.EnvironmentVariableScope | undefined): void {
        const folder = scope?.workspaceFolder;
        if (folder === undefined) {
            this.map.clear();
            this.descriptionMap.clear();
        } else {
            for (const [key, mutator] of this.map) {
                if (mutator.scope?.workspaceFolder?.index === folder.index) this.map.delete(key);
            }
            this.descriptionMap.delete(scopeKey(scope));
        }
        this.onDidChangeEmitter.fire();
    }

    public setDescription(
        description: string | vscode.MarkdownString | undefined,
        scope: vscode.EnvironmentVariableScope | undefined,
    ): void {
        const key = scopeKey(scope);
        // Up to the first paragraph of a MarkdownString: upstream does this to protect the UI.
        const text = typeof description === "string" ? description : description?.value.split("\n\n")[0];
        const current = this.descriptionMap.get(key);
        if (current !== undefined && current.description === text) return;
        this.descriptionMap.set(key, { description: text, scope: toWireScope(scope) });
        this.onDidChangeEmitter.fire();
    }

    public getDescription(scope: vscode.EnvironmentVariableScope | undefined): string | undefined {
        return this.descriptionMap.get(scopeKey(scope))?.description;
    }

    private createScoped(scope: vscode.EnvironmentVariableScope | undefined): ScopedCollection {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- scoped collection methods close over the unified one
        const unified = this;
        return {
            get persistent(): boolean {
                return unified.persistent;
            },
            set persistent(value: boolean) {
                unified.persistent = value;
            },
            get description(): string | undefined {
                return unified.getDescription(scope);
            },
            set description(value: string | vscode.MarkdownString | undefined) {
                unified.setDescription(value, scope);
            },
            getScoped: (inner) => unified.getScoped(inner),
            replace: (variable, value, options) => {
                unified.setMutator(variable, value, EnvironmentVariableMutatorType.Replace, options, scope);
            },
            append: (variable, value, options) => {
                unified.setMutator(variable, value, EnvironmentVariableMutatorType.Append, options, scope);
            },
            prepend: (variable, value, options) => {
                unified.setMutator(variable, value, EnvironmentVariableMutatorType.Prepend, options, scope);
            },
            get: (variable) => unified.get(variable, scope),
            forEach(callback, thisArg?: unknown) {
                for (const [variable, mutator] of unified.variableMap(scope)) {
                    callback.call(thisArg, variable, mutator, this);
                }
            },
            delete: (variable) => {
                unified.delete(variable, scope);
            },
            clear: () => {
                unified.clear(scope);
            },
            [Symbol.iterator]: () => unified.variableMap(scope).entries(),
        };
    }
}
