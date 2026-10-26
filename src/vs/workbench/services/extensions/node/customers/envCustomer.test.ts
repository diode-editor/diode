import { existsSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { getSystemShell } from "../../../../../base/node/shell.ts";
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
    peer.handleNotification("env.initialize", (params) => log.push(params));
    const attachTo = () => customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { customer, log, attachTo };
}

describe("EnvCustomer — env.initialize seed", () => {
    it("sends the machine id, shell and app root to a live spawn; without a spawn — silent", async () => {
        let shell = "/bin/zsh";
        const h = setup({ machineId: () => "m-1", defaultShell: () => shell, appRoot: () => "/cache/rg/1" });
        h.customer.pushInitialState();
        h.attachTo();
        h.customer.pushInitialState();
        // Each spawn gets the current shell: the value is read at seed time.
        shell = "/usr/bin/fish";
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toStrictEqual([
            { machineId: "m-1", shell: "/bin/zsh", appRoot: "/cache/rg/1" },
            { machineId: "m-1", shell: "/usr/bin/fish", appRoot: "/cache/rg/1" },
        ]);
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
    });
});
