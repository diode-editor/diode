import { existsSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { getSystemShell } from "../../../../../base/node/shell.ts";
import { LogLevel } from "../../../../../platform/log/common/logLevel.ts";
import { LogService } from "../../../../../platform/log/common/logService.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { loadRipgrepAppRoot, RIPGREP_APP_ROOT_DIR } from "../../../search/node/loadRipgrep.ts";

import { EnvCustomer, fallbackExtensionHostEnvironment, type IExtensionHostEnvironment } from "./envCustomer.ts";

const RG = process.platform === "win32" ? "rg.exe" : "rg";

function setup(environment: IExtensionHostEnvironment) {
    const customer = new EnvCustomer(undefined, undefined, environment);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const log: unknown[] = [];
    const levelChanges: unknown[] = [];
    peer.handleNotification("env.initialize", (params) => log.push(params));
    peer.handleNotification("env.didChangeLogLevel", (params) => levelChanges.push(params));
    const attachTo = () => customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { customer, log, levelChanges, attachTo };
}

function windowLevelEnvironment(logService: LogService): IExtensionHostEnvironment {
    return {
        machineId: () => "m-1",
        defaultShell: () => "/bin/sh",
        appRoot: () => "",
        logLevel: () => logService.getWindowLevel(),
        onDidChangeLogLevel: logService.onDidChangeWindowLevel,
    };
}

describe("EnvCustomer — env.initialize seed", () => {
    it("sends the machine id, shell and app root to a live spawn; without a spawn — silent", async () => {
        let shell = "/bin/zsh";
        const h = setup({
            ...fallbackExtensionHostEnvironment(),
            machineId: () => "m-1",
            defaultShell: () => shell,
            appRoot: () => "/cache/rg/1",
        });
        h.customer.pushInitialState();
        h.attachTo();
        h.customer.pushInitialState();
        // Each spawn gets the current shell: the value is read at seed time.
        shell = "/usr/bin/fish";
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toStrictEqual([
            { machineId: "m-1", shell: "/bin/zsh", appRoot: "/cache/rg/1", logLevel: 3 },
            { machineId: "m-1", shell: "/usr/bin/fish", appRoot: "/cache/rg/1", logLevel: 3 },
        ]);
    });

    it("seeds the window log level current at spawn time, in the API's numbering", async () => {
        const logService = new LogService();
        const h = setup(windowLevelEnvironment(logService));
        h.attachTo();
        h.customer.pushInitialState();
        logService.setLevel("*", LogLevel.Debug);
        h.customer.pushInitialState();
        logService.setLevel("*", LogLevel.Error);
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log.map((seed) => (seed as { logLevel: number }).logLevel)).toEqual([3, 2, 5]);
    });
});

describe("EnvCustomer — env.didChangeLogLevel", () => {
    it("a window level change goes to the live spawn; a channel rule and the same level — silent", async () => {
        const logService = new LogService();
        const h = setup(windowLevelEnvironment(logService));
        h.attachTo();
        logService.setLevel("*", LogLevel.Trace);
        logService.setLevel("*", LogLevel.Trace);
        logService.setLevel("extensions", LogLevel.Error);
        logService.setLevel("*", LogLevel.Off);
        logService.setLevel("*", LogLevel.Warn);
        await flushMicrotasks();
        expect(h.levelChanges).toEqual([{ logLevel: 1 }, { logLevel: 0 }, { logLevel: 4 }]);
    });

    it("a dead spawn stops hearing changes; each spawn subscribes on its own", async () => {
        const logService = new LogService();
        const h = setup(windowLevelEnvironment(logService));
        const first = h.attachTo();
        const second = h.attachTo();
        logService.setLevel("*", LogLevel.Debug);
        first.dispose();
        logService.setLevel("*", LogLevel.Trace);
        second.dispose();
        logService.setLevel("*", LogLevel.Off);
        await flushMicrotasks();
        expect(h.levelChanges).toEqual([{ logLevel: 2 }, { logLevel: 2 }, { logLevel: 1 }]);
    });
});

describe("fallbackExtensionHostEnvironment", () => {
    it("the machine id is computed once per host; the shell is the system one; appRoot holds rg", () => {
        const env = fallbackExtensionHostEnvironment();
        const id = env.machineId();
        expect(id).toMatch(/^([0-9a-f]{64}|[0-9a-f-]{36})$/);
        expect(env.machineId()).toBe(id);
        expect(env.defaultShell()).toBe(getSystemShell());
        expect(env.appRoot()).toBe(loadRipgrepAppRoot());
        expect(existsSync(path.join(env.appRoot(), RIPGREP_APP_ROOT_DIR, RG))).toBe(true);
        expect(env.logLevel()).toBe(LogLevel.Info);
    });
});
