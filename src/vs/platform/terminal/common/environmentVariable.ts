// Типы — они же форма провода и состояния: коллекция живёт в субпроцессе, хост её хранит и
// применяет к окружению каждого терминала.

/** Значения — эталонные. */
export enum EnvironmentVariableMutatorType {
    Replace = 1,
    Append = 2,
    Prepend = 3,
}

export interface IEnvironmentVariableMutatorOptions {
    readonly applyAtProcessCreation?: boolean;
    readonly applyAtShellIntegration?: boolean;
}

/** Папка воркспейса в области коллекции: применяется к терминалу этой папки (по `index`). */
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

/** Коллекция одного расширения: ключ — переменная, с областью — `<переменная>:::<uri папки>`. */
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

/** Переменные активации Python трогает только расширение окружений Python (эталон). */
const PYTHON_ACTIVATION_VARS_PATTERN = /^VSCODE_PYTHON_(PWSH|ZSH|BASH|FISH)_ACTIVATE/;
const PYTHON_ENV_EXTENSION_ID = "ms-python.vscode-python-envs";

function blockPythonActivationVar(variable: string, extensionIdentifier: string): boolean {
    return PYTHON_ACTIVATION_VARS_PATTERN.test(variable) && extensionIdentifier !== PYTHON_ENV_EXTENSION_ID;
}

/** `Replace` первым отсекает остальные мутаторы; применяются в обратном порядке заведения. */
export class MergedEnvironmentVariableCollection {
    private readonly map = new Map<string, IExtensionOwnedEnvironmentVariableMutator[]>();

    public constructor(collections: ReadonlyMap<string, IEnvironmentVariableCollection>) {
        for (const [extensionIdentifier, collection] of collections) {
            for (const [key, mutator] of collection.map) {
                if (blockPythonActivationVar(key, extensionIdentifier)) continue;
                const entry = this.map.get(key) ?? [];
                this.map.set(key, entry);
                // Replace первым — остальные он всё равно перезапишет.
                if (entry.at(0)?.type === EnvironmentVariableMutatorType.Replace) continue;
                entry.unshift({ ...mutator, extensionIdentifier });
            }
        }
    }

    /** Мутаторы, действующие в области `scope`: глобальные и той же папки. */
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
     * Под Windows имя сверяется без регистра. Только при создании процесса: `applyAtShellIntegration`
     * читать некому — shell integration нет.
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
                if (!(mutator.options?.applyAtProcessCreation ?? true)) continue;
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
        }
    }
}

/** Как у эталона, мутатор с областью без папки (`getScoped({})`) не применяется нигде. */
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
