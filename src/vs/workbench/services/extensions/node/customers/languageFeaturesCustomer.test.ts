import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";

import { LanguageFeaturesCustomer } from "./languageFeaturesCustomer.ts";

const HOVER = { handle: 1, kind: "hover", selector: [{ language: "typescript" }] };
const COMPLETION = { handle: 2, kind: "completion", selector: [], triggerCharacters: ["."] };

function setup() {
    const customer = new LanguageFeaturesCustomer();
    const changed = vi.fn();
    customer.onProvidersChanged(changed);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const attached = customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { customer, changed, peer, attached };
}

describe("LanguageFeaturesCustomer — реестр провайдеров спавна", () => {
    it("регистрация и снятие меняют состав с событием; мусор и чужой handle — без события", async () => {
        const h = setup();
        h.peer.notify("languages.register", HOVER);
        h.peer.notify("languages.register", COMPLETION);
        h.peer.notify("languages.register", { handle: 3, kind: "nonsense", selector: [] });
        h.peer.notify("languages.register", null);
        await flushMicrotasks();
        expect(h.customer.getProviders()).toEqual([HOVER, COMPLETION]);
        expect(h.changed).toHaveBeenCalledTimes(2);

        h.peer.notify("languages.unregister", { handle: 1 });
        h.peer.notify("languages.unregister", { handle: 1 });
        h.peer.notify("languages.unregister", { handle: 99 });
        h.peer.notify("languages.unregister", null);
        await flushMicrotasks();
        expect(h.customer.getProviders()).toEqual([COMPLETION]);
        expect(h.changed).toHaveBeenCalledTimes(3);
    });

    it("уход спавна снимает его провайдеров с событием; пустой спавн уходит молча", async () => {
        const h = setup();
        h.peer.notify("languages.register", HOVER);
        await flushMicrotasks();
        h.changed.mockClear();

        h.attached.dispose();
        expect(h.customer.getProviders()).toEqual([]);
        expect(h.changed).toHaveBeenCalledOnce();

        const empty = setup();
        empty.attached.dispose();
        expect(empty.changed).not.toHaveBeenCalled();
    });

    it("getProviders отдаёт снимок, а не живую коллекцию", async () => {
        const h = setup();
        h.peer.notify("languages.register", HOVER);
        await flushMicrotasks();
        const snapshot = h.customer.getProviders();
        h.peer.notify("languages.register", COMPLETION);
        await flushMicrotasks();
        expect(snapshot).toEqual([HOVER]);
    });
});
