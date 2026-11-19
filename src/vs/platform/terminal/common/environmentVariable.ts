// These types are also the wire and state shape: the collection lives in the subprocess, the host
// stores it and applies it to each terminal's environment.

/** Values match upstream. */
export enum EnvironmentVariableMutatorType {
    Replace = 1,
    Append = 2,
    Prepend = 3,
}

export interface IEnvironmentVariableMutatorOptions {
    readonly applyAtProcessCreation?: boolean;
    readonly applyAtShellIntegration?: boolean;
}

/** Workspace folder in the collection scope: applies to that folder's terminal (by `index`). */
export interface IEnvironmentVariableScope {
    readonly workspaceFolder?: { readonly uri: string; readonly name: string; readonly index: number };
}

export interface IEnvironmentVariableMutator {
    readonly variable: string;
    readonly value: string;
    readonly type: EnvironmentVariableMutatorType;
    readonly options?: IEnvironmentVariableMutatorOptions;
    readonly scope?: IEnvironmentVariableScope;
}

export interface IEnvironmentVariableCollectionDescription {
    readonly description: string | undefined;
    readonly scope: IEnvironmentVariableScope | undefined;
}

/** One extension's collection: the key is the variable, or `<variable>:::<folder uri>` with a scope. */
export type SerializableEnvironmentVariableCollection = readonly (readonly [string, IEnvironmentVariableMutator])[];
export type SerializableEnvironmentDescriptionMap = readonly (readonly [
    string,
    IEnvironmentVariableCollectionDescription,
])[];

export interface IEnvironmentVariableCollection {
    readonly map: ReadonlyMap<string, IEnvironmentVariableMutator>;
    readonly descriptionMap?: ReadonlyMap<string, IEnvironmentVariableCollectionDescription>;
}

export interface IExtensionOwnedEnvironmentVariableMutator extends IEnvironmentVariableMutator {
    readonly extensionIdentifier: string;
}

/** Upstream `mutatorTypeToLabelMap`: the suffix of the `VSCODE_ENV_*` variable the shell integration script reads. */
const MUTATOR_TYPE_LABELS: Record<EnvironmentVariableMutatorType, string> = {
    [EnvironmentVariableMutatorType.Replace]: "REPLACE",
    [EnvironmentVariableMutatorType.Append]: "APPEND",
    [EnvironmentVariableMutatorType.Prepend]: "PREPEND",
};

/** Only the Python environments extension may touch Python activation variables (as upstream). */
const PYTHON_ACTIVATION_VARS_PATTERN = /^VSCODE_PYTHON_(PWSH|ZSH|BASH|FISH)_ACTIVATE/;
const PYTHON_ENV_EXTENSION_ID = "ms-python.vscode-python-envs";

function blockPythonActivationVar(variable: string, extensionIdentifier: string): boolean {
    return PYTHON_ACTIVATION_VARS_PATTERN.test(variable) && extensionIdentifier !== PYTHON_ENV_EXTENSION_ID;
}

/** A leading `Replace` cuts off the other mutators; they apply in reverse order of addition. */
export class MergedEnvironmentVariableCollection {
    private readonly map = new Map<string, IExtensionOwnedEnvironmentVariableMutator[]>();

    public constructor(collections: ReadonlyMap<string, IEnvironmentVariableCollection>) {
        for (const [extensionIdentifier, collection] of collections) {
            for (const [key, mutator] of collection.map) {
                if (blockPythonActivationVar(key, extensionIdentifier)) continue;
                const entry = this.map.get(key) ?? [];
                this.map.set(key, entry);
                // A leading Replace would overwrite the rest anyway.
                if (entry.at(0)?.type === EnvironmentVariableMutatorType.Replace) continue;
                entry.unshift({ ...mutator, extensionIdentifier });
            }
        }
    }

    /** Mutators in effect for `scope`: global ones and those of the same folder. */
    public getVariableMap(
        scope: IEnvironmentVariableScope | undefined,
    ): Map<string, IExtensionOwnedEnvironmentVariableMutator[]> {
        const result = new Map<string, IExtensionOwnedEnvironmentVariableMutator[]>();
        for (const mutators of this.map.values()) {
            const filtered = mutators.filter((m) => filterScope(m, scope));
            const first = filtered.at(0);
            if (first !== undefined) result.set(first.variable, filtered);
        }
        return result;
    }

    /**
     * On Windows names compare case-insensitively. A mutator with `applyAtShellIntegration` also goes into
     * `VSCODE_ENV_REPLACE|PREPEND|APPEND` as `<variable>=<value>` joined by `:` (a `:` in the value is `\\x3a`): the
     * shell integration script applies it after the user's rc files. Without injection the variables stay unused.
     */
    public applyToProcessEnvironment(
        env: Record<string, string | undefined>,
        scope: IEnvironmentVariableScope | undefined,
        isWindows: boolean,
    ): void {
        const actualNames = new Map<string, string>();
        if (isWindows) for (const name of Object.keys(env)) actualNames.set(name.toLowerCase(), name);
        for (const [variable, mutators] of this.getVariableMap(scope)) {
            const actual = actualNames.get(variable.toLowerCase()) ?? variable;
            for (const mutator of mutators) {
                if (mutator.options?.applyAtProcessCreation ?? true) {
                    switch (mutator.type) {
                        case EnvironmentVariableMutatorType.Append:
                            env[actual] = (env[actual] ?? "") + mutator.value;
                            break;
                        case EnvironmentVariableMutatorType.Prepend:
                            env[actual] = mutator.value + (env[actual] ?? "");
                            break;
                        case EnvironmentVariableMutatorType.Replace:
                            env[actual] = mutator.value;
                            break;
                    }
                }
                if (mutator.options?.applyAtShellIntegration ?? false) {
                    const key = `VSCODE_ENV_${MUTATOR_TYPE_LABELS[mutator.type]}`;
                    const current = env[key];
                    const entry = `${variable}=${mutator.value.replaceAll(":", "\\x3a")}`;
                    env[key] = current === undefined || current === "" ? entry : `${current}:${entry}`;
                }
            }
        }
    }

    /**
     * Upstream `addEnvMixinPathPrefix`: every `Prepend` to `PATH` in effect for `scope`, joined — the script re-applies
     * it after a profile that rebuilds `PATH` (fish's `fish_user_paths`, macOS `path_helper`).
     */
    public getPathPrefix(scope: IEnvironmentVariableScope | undefined): string | undefined {
        const prefix = (this.getVariableMap(scope).get("PATH") ?? [])
            .filter((m) => m.type === EnvironmentVariableMutatorType.Prepend)
            .map((m) => m.value)
            .join("");
        return prefix === "" ? undefined : prefix;
    }
}

/** As upstream, a mutator with a folderless scope (`getScoped({})`) applies nowhere. */
function filterScope(mutator: IEnvironmentVariableMutator, scope: IEnvironmentVariableScope | undefined): boolean {
    if (mutator.scope === undefined) return true;
    const folder = mutator.scope.workspaceFolder;
    return folder !== undefined && folder.index === scope?.workspaceFolder?.index;
}

export interface IEnvironmentVariableCollectionWithPersistence extends IEnvironmentVariableCollection {
    readonly persistent: boolean;
}

export interface IEnvironmentVariableCollectionStore {
    readonly collections: ReadonlyMap<string, IEnvironmentVariableCollectionWithPersistence>;
    set(extensionIdentifier: string, collection: IEnvironmentVariableCollectionWithPersistence): void;
    delete(extensionIdentifier: string): void;
}
