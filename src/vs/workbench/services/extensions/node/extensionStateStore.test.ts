import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { resolveUserDataPaths } from "../../../../platform/environment/node/userDataPaths.ts";
import { loadState } from "../../../../platform/state/node/stateService.ts";
import { computeWorkspaceId } from "../../../../platform/workspace/common/workspaceId.ts";

import {
    createExtensionStateStore,
    createTransientExtensionStateStore,
    extensionStateDescriptor,
} from "./extensionStateStore.ts";

describe("extensionStateStore", () => {
    let userData: ITempWorkspace;

    beforeEach(() => {
        userData = createTempWorkspace({ prefix: "diode-ext-state-" });
    });

    afterEach(() => {
        userData.dispose();
    });

    function paths() {
        return resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir });
    }

    it("дескриптор: свой ключ на расширение, globalState — global, workspaceState — workspace", () => {
        expect(extensionStateDescriptor("acme.ext", true)).toEqual({
            key: "extensionState/acme.ext",
            scope: "global",
            default: {},
        });
        expect(extensionStateDescriptor("acme.ext", false).scope).toBe("workspace");
    });

    it("memento переживает перезапуск: глобальный и воркспейсный словари раздельно", () => {
        const p = paths();
        const project = computeWorkspaceId("/projects/alpha");
        const first = loadState(p);
        first.openWorkspace(project);
        const store = createExtensionStateStore(first);
        store.set("acme.ext", true, { shown: true });
        store.set("acme.ext", false, { lastFile: "a.ts" });
        first.flushSync();

        const second = loadState(p);
        second.openWorkspace(project);
        const reopened = createExtensionStateStore(second);
        expect(reopened.get("acme.ext", true)).toEqual({ shown: true });
        expect(reopened.get("acme.ext", false)).toEqual({ lastFile: "a.ts" });
        expect(reopened.get("other.ext", true)).toEqual({});
    });

    it("пустой словарь удаляет запись — файл не копит {}", () => {
        const p = paths();
        const state = loadState(p);
        const store = createExtensionStateStore(state);
        store.set("acme.ext", true, { a: 1 });
        store.set("acme.ext", true, {});
        state.flushSync();

        expect(JSON.parse(fs.readFileSync(p.globalStateFile, "utf-8"))).toEqual({});
    });

    it("transient: словари пусты, записи никуда не уходят", () => {
        const store = createTransientExtensionStateStore();
        store.set("acme.ext", true, { a: 1 });
        expect(store.get("acme.ext", true)).toEqual({});
    });
});
