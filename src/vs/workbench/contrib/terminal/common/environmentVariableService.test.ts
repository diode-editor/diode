import { describe, expect, it } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import {
    EnvironmentVariableMutatorType,
    type IEnvironmentVariableCollectionWithPersistence,
} from "../../../../platform/terminal/common/environmentVariable.ts";
import type { WorkspaceId } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

import { ENVIRONMENT_VARIABLE_COLLECTIONS_STATE, EnvironmentVariableService } from "./environmentVariableService.ts";

/** In-memory state: a store per workspace; `openWorkspace` switches the workspace scope. */
function memoryState(initial: Record<string, unknown> = {}) {
    const stores = new Map<string, Map<string, unknown>>([["empty", new Map(Object.entries(initial))]]);
    let current = "empty";
    const opened = new Emitter<WorkspaceId>();
    const store = (): Map<string, unknown> => {
        let s = stores.get(current);
        if (s === undefined) {
            s = new Map();
            stores.set(current, s);
        }
        return s;
    };
    const service: IStateService = {
        get<T>(d: IStateDescriptor<T>): T {
            return store().has(d.key) ? (store().get(d.key) as T) : d.default;
        },
        store<T>(d: IStateDescriptor<T>, value: T): void {
            store().set(d.key, value);
        },
        remove: () => undefined,
        openWorkspace: (id) => {
            current = id;
            opened.fire(id);
        },
        flushSync: () => undefined,
        dispose: () => undefined,
        onDidOpenWorkspace: opened.event,
    };
    return { service, stored: () => store().get(ENVIRONMENT_VARIABLE_COLLECTIONS_STATE.key), stores };
}

const mutator = { variable: "P", value: "1", type: EnvironmentVariableMutatorType.Replace, options: {} };

function collection(persistent: boolean, value = "1"): IEnvironmentVariableCollectionWithPersistence {
    return {
        persistent,
        map: new Map([["P", { ...mutator, value }]]),
        descriptionMap: new Map([["", { description: "d", scope: undefined }]]),
    };
}

describe("EnvironmentVariableService", () => {
    it("state key and scope match upstream", () => {
        expect(ENVIRONMENT_VARIABLE_COLLECTIONS_STATE).toEqual({
            key: "terminal.integrated.environmentVariableCollectionsV2",
            scope: "workspace",
            default: [],
        });
    });

    it("set: the collection is in the merge, persistent ones are in state (with descriptions), others aren't", () => {
        const state = memoryState();
        const service = new EnvironmentVariableService(state.service);
        service.set("keep.ext", collection(true));
        service.set("temp.ext", collection(false, "2"));
        expect(service.collections.size).toBe(2);
        const env: Record<string, string | undefined> = {};
        service.mergedCollection.applyToProcessEnvironment(env, undefined, false);
        expect(env.P).toBe("1");
        expect(state.stored()).toEqual([
            {
                extensionIdentifier: "keep.ext",
                collection: [["P", mutator]],
                description: [["", { description: "d", scope: undefined }]],
            },
        ]);
    });

    it("a collection without descriptions has an empty description list in state", () => {
        const state = memoryState();
        const service = new EnvironmentVariableService(state.service);
        service.set("a.b", { persistent: true, map: new Map([["P", mutator]]) });
        expect(state.stored()).toEqual([{ extensionIdentifier: "a.b", collection: [["P", mutator]], description: [] }]);
    });

    it("delete removes the collection from the merge and state", () => {
        const state = memoryState();
        const service = new EnvironmentVariableService(state.service);
        service.set("a.b", collection(true));
        service.delete("a.b");
        const env: Record<string, string | undefined> = {};
        service.mergedCollection.applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({});
        expect(state.stored()).toEqual([]);
        expect(service.collections.size).toBe(0);
    });

    it("reads stored (persistent) collections at startup, skips foreign entries", () => {
        const state = memoryState({
            [ENVIRONMENT_VARIABLE_COLLECTIONS_STATE.key]: [
                { extensionIdentifier: "a.b", collection: [["P", mutator]], description: [["", { description: "d" }]] },
                { collection: [] },
                "junk",
            ],
        });
        const service = new EnvironmentVariableService(state.service);
        expect([...service.collections.keys()]).toEqual(["a.b"]);
        const loaded = service.collections.get("a.b");
        expect(loaded?.persistent).toBe(true);
        expect([...(loaded?.map ?? [])]).toEqual([["P", mutator]]);
        expect([...(loaded?.descriptionMap ?? [])]).toEqual([["", { description: "d", scope: undefined }]]);
        const env: Record<string, string | undefined> = {};
        service.mergedCollection.applyToProcessEnvironment(env, undefined, false);
        expect(env.P).toBe("1");
    });

    it("state that isn't a list — empty", () => {
        const service = new EnvironmentVariableService(
            memoryState({ [ENVIRONMENT_VARIABLE_COLLECTIONS_STATE.key]: { broken: true } }).service,
        );
        expect(service.collections.size).toBe(0);
    });

    it("workspace change — collections are reread from its storage", () => {
        const state = memoryState();
        const service = new EnvironmentVariableService(state.service);
        service.set("a.b", collection(true));
        state.service.openWorkspace("other" as WorkspaceId);
        expect(service.collections.size).toBe(0);
        const env: Record<string, string | undefined> = {};
        service.mergedCollection.applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({});
        state.service.openWorkspace("empty" as WorkspaceId);
        expect([...service.collections.keys()]).toEqual(["a.b"]);
    });

    it("installed set: collections of removed extensions are forgotten both in memory and in state", () => {
        const state = memoryState();
        const service = new EnvironmentVariableService(state.service);
        service.set("kept.ext", collection(true));
        service.set("gone.ext", collection(true, "2"));
        service.setInstalledExtensions((id) => id === "kept.ext");
        expect([...service.collections.keys()]).toEqual(["kept.ext"]);
        expect((state.stored() as { extensionIdentifier: string }[]).map((e) => e.extensionIdentifier)).toEqual([
            "kept.ext",
        ]);
        const env: Record<string, string | undefined> = {};
        service.mergedCollection.applyToProcessEnvironment(env, undefined, false);
        expect(env.P).toBe("1");
    });

    it("all installed — state isn't rewritten", () => {
        const state = memoryState({ [ENVIRONMENT_VARIABLE_COLLECTIONS_STATE.key]: "untouched" });
        const service = new EnvironmentVariableService(state.service);
        service.setInstalledExtensions(() => true);
        expect(state.stored()).toBe("untouched");
    });

    it("after the installed set, reading another workspace drops removed ones and rewrites state", () => {
        const state = memoryState();
        const service = new EnvironmentVariableService(state.service);
        service.setInstalledExtensions((id) => id === "kept.ext");
        state.stores.set(
            "other",
            new Map([
                [
                    ENVIRONMENT_VARIABLE_COLLECTIONS_STATE.key,
                    [
                        { extensionIdentifier: "kept.ext", collection: [["P", mutator]] },
                        { extensionIdentifier: "gone.ext", collection: [["P", mutator]] },
                    ],
                ],
            ]),
        );
        state.service.openWorkspace("other" as WorkspaceId);
        expect([...service.collections.keys()]).toEqual(["kept.ext"]);
        expect((state.stored() as { extensionIdentifier: string }[]).map((e) => e.extensionIdentifier)).toEqual([
            "kept.ext",
        ]);
    });

    it("reading without removed ones doesn't rewrite state", () => {
        const raw = [{ extensionIdentifier: "a.b", collection: [["P", mutator]] }];
        const state = memoryState({ [ENVIRONMENT_VARIABLE_COLLECTIONS_STATE.key]: raw });
        new EnvironmentVariableService(state.service);
        expect(state.stored()).toBe(raw);
    });

    it("dispose unsubscribes from workspace changes", () => {
        const state = memoryState();
        const service = new EnvironmentVariableService(state.service);
        service.set("a.b", collection(true));
        service.dispose();
        state.service.openWorkspace("other" as WorkspaceId);
        expect(service.collections.size).toBe(1);
    });
});
