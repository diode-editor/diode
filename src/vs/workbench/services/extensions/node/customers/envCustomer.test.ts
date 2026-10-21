import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { getSystemShell } from "../../../../../base/node/shell.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";

import { EnvCustomer, fallbackExtensionHostEnvironment, type IExtensionHostEnvironment } from "./envCustomer.ts";

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
    it("sends the machine id and shell to a live spawn; without a spawn — silent", async () => {
        let shell = "/bin/zsh";
        const h = setup({ machineId: () => "m-1", defaultShell: () => shell });
        h.customer.pushInitialState();
        h.attachTo();
        h.customer.pushInitialState();
        // Each spawn gets the current shell: the value is read at seed time.
        shell = "/usr/bin/fish";
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.log).toStrictEqual([
            { machineId: "m-1", shell: "/bin/zsh" },
            { machineId: "m-1", shell: "/usr/bin/fish" },
        ]);
    });
});

describe("fallbackExtensionHostEnvironment", () => {
    it("the machine id is computed once per host; the shell is the system one", () => {
        const env = fallbackExtensionHostEnvironment();
        const id = env.machineId();
        expect(id).toMatch(/^([0-9a-f]{64}|[0-9a-f-]{36})$/);
        expect(env.machineId()).toBe(id);
        expect(env.defaultShell()).toBe(getSystemShell());
    });
});
