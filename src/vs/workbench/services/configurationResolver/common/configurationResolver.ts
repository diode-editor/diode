import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

/** Upstream's `IConfigurationResolverService`: `${…}` variables of tasks.json and launch.json. */
export interface IConfigurationResolverService {
    /**
     * Recursively resolves the variables in a copy of `config`. `${command:…}` and `${input:…}` stay as they are:
     * they need interaction.
     */
    resolveAsync<T>(folder: IWorkspaceFolder | undefined, config: T): Promise<T>;

    /**
     * Resolves all variables of `config`, commands and inputs included, into a map `name:arg` → value
     * (e.g. `input:name`); `undefined` — the user cancelled an input or a command returned nothing.
     *
     * @param section `tasks` or `launch`: the key under which the last input values are remembered.
     * @param variables Aliases of command ids (debug adapters' `variables`).
     * @param inputs The `inputs` section of the file `config` comes from (upstream reads it from the configuration
     *   section: our tasks.json and launch.json are not part of the configuration). Read only when an
     *   `${input:…}` is met.
     */
    resolveWithInteraction(
        folder: IWorkspaceFolder | undefined,
        config: unknown,
        section?: string,
        variables?: Readonly<Record<string, string>>,
        inputs?: () => Promise<readonly unknown[] | undefined>,
    ): Promise<Map<string, string> | undefined>;

    /** {@link resolveWithInteraction} that returns the resolved copy of `config` itself. */
    resolveWithInteractionReplace<T>(
        folder: IWorkspaceFolder | undefined,
        config: T,
        section?: string,
        variables?: Readonly<Record<string, string>>,
        inputs?: () => Promise<readonly unknown[] | undefined>,
    ): Promise<T | undefined>;

    /**
     * Synchronous resolution with values already acquired by {@link resolveWithInteraction} (keyed `name:arg`); the
     * rest are resolved as {@link resolveAsync} does. Upstream's `VariableResolver` of the terminal task system.
     */
    resolveWithValues<T>(folder: IWorkspaceFolder | undefined, config: T, values: ReadonlyMap<string, string>): T;
}

interface IPromptStringInput {
    readonly id: string;
    readonly type: "promptString";
    readonly description: string;
    readonly default?: string;
    readonly password?: boolean;
}

interface IPickStringInput {
    readonly id: string;
    readonly type: "pickString";
    readonly description: string;
    readonly options: readonly (string | { readonly value: string; readonly label?: string })[];
    readonly default?: string;
}

interface ICommandInput {
    readonly id: string;
    readonly type: "command";
    readonly command: string;
    readonly args?: unknown;
}

/** An entry of the `inputs` section, as upstream. */
export type ConfiguredInput = IPromptStringInput | IPickStringInput | ICommandInput;

/** Upstream texts: the message is shown to the user as is. */
export class VariableError extends Error {}
