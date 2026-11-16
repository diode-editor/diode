import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../base/common/uri.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor, Token } from "../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceFolder, WorkbenchState } from "../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { IConfig } from "../../workbench/contrib/debug/common/debug.ts";
import { ConfigurationResolverServiceDIToken } from "../../workbench/services/configurationResolver/browser/configurationResolverService.ts";

import { debugVariableResolver } from "./debugPorts.ts";

const FOLDER: IWorkspaceFolder = { uri: Uri.file("/w"), name: "w", index: 0 };
const CONFIG: IConfig = { type: "lldb", request: "launch", name: "Launch" };

const inputs = (id: string) => ({ inputs: [{ id, type: "promptString", description: id }] });

// `${input:…}` of a launch configuration reads the `inputs` of the file it comes from, as upstream's `resolveInputs`.
describe("debugVariableResolver", () => {
    function setup(workbenchState: WorkbenchState = "folder") {
        const resolveWithInteractionReplace = vi.fn(
            async (
                _folder: unknown,
                config: IConfig,
                _section: string,
                _variables: unknown,
                readInputs: () => Promise<readonly unknown[] | undefined>,
            ) => ({ ...config, inputs: await readInputs() }),
        );
        const layers = {
            user: inputs("user"),
            profile: undefined as unknown,
            workspace: inputs("workspace") as unknown,
            workspaceFolder: inputs("workspaceFolder"),
        };
        let merged: unknown = inputs("merged");
        const services = new Map<Token<unknown>, unknown>([
            [ConfigurationResolverServiceDIToken, { resolveWithInteractionReplace }],
            [
                IConfigurationServiceDIToken,
                {
                    inspect: (key: string) => {
                        expect(key).toBe("launch");
                        return layers;
                    },
                    get: (key: string) => {
                        expect(key).toBe("launch");
                        return merged;
                    },
                },
            ],
            [IWorkspaceContextServiceDIToken, { getWorkbenchState: () => workbenchState }],
        ]);
        const accessor: ServiceAccessor = { get: <T>(token: Token<T>): T => services.get(token) as T };
        const resolve = debugVariableResolver(accessor);
        const inputsOf = async (target?: IConfig["__configurationTarget"]): Promise<unknown> =>
            ((await resolve(FOLDER, { ...CONFIG, __configurationTarget: target }, undefined)) as { inputs?: unknown })
                .inputs;
        return {
            resolve,
            inputsOf,
            layers,
            resolveWithInteractionReplace,
            setMerged: (value: unknown) => {
                merged = value;
            },
        };
    }

    it("resolves through the configuration resolver under `launch` with the debugger's aliases", async () => {
        const { resolve, resolveWithInteractionReplace } = setup();
        const variables = { pickProcess: "lldb.pickProcess" };

        await resolve(FOLDER, CONFIG, variables);

        expect(resolveWithInteractionReplace).toHaveBeenCalledWith(
            FOLDER,
            CONFIG,
            "launch",
            variables,
            expect.any(Function),
        );
    });

    it("a folder's launch.json is the workspace layer of a folder window and the folder layer of a `.code-workspace` one", async () => {
        expect(await setup("folder").inputsOf("workspaceFolder")).toEqual(inputs("workspace").inputs);
        expect(await setup("workspace").inputsOf("workspaceFolder")).toEqual(inputs("workspaceFolder").inputs);
        // A configuration of no file (passed as an object) reads as a folder's.
        expect(await setup("folder").inputsOf(undefined)).toEqual(inputs("workspace").inputs);
    });

    it("the `.code-workspace` file's and the user's: the profile over the user settings", async () => {
        const { inputsOf, layers } = setup("workspace");
        expect(await inputsOf("workspace")).toEqual(inputs("workspace").inputs);
        expect(await inputsOf("user")).toEqual(inputs("user").inputs);
        layers.profile = inputs("profile");
        expect(await inputsOf("user")).toEqual(inputs("profile").inputs);
    });

    it("a file without inputs falls back to the merged `launch`; inputs that are not an array are none", async () => {
        const { inputsOf, layers, setMerged } = setup();
        layers.workspace = {};
        expect(await inputsOf("workspaceFolder")).toEqual(inputs("merged").inputs);
        layers.workspace = undefined;
        expect(await inputsOf("workspaceFolder")).toEqual(inputs("merged").inputs);
        setMerged(undefined);
        expect(await inputsOf("workspaceFolder")).toBeUndefined();
        layers.workspace = { inputs: { id: "x" } };
        expect(await inputsOf("workspaceFolder")).toBeUndefined();
    });
});
