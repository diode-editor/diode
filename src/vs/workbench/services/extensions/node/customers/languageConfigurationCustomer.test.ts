import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { ILanguageConfiguration } from "../../../../../platform/extensions/common/iLanguageConfiguration.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { parseWireLanguageConfiguration } from "../hostWireParsers.ts";

import { LanguageConfigurationCustomer } from "./languageConfigurationCustomer.ts";

function recordingService() {
    const live: { languageId: string; configuration: ILanguageConfiguration }[] = [];
    /** Disposing the same layer twice counts too. */
    const disposals = { count: 0 };
    return {
        live,
        disposals,
        register: (languageId: string, configuration: ILanguageConfiguration) => {
            const layer = { languageId, configuration };
            live.push(layer);
            return {
                dispose: () => {
                    disposals.count++;
                    const index = live.indexOf(layer);
                    if (index >= 0) live.splice(index, 1);
                },
            };
        },
    };
}

function setup() {
    const service = recordingService();
    const customer = new LanguageConfigurationCustomer(service);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const spawn = customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { service, peer, spawn };
}

const COMMENTS = { comments: { lineComment: "//" } };

describe("LanguageConfigurationCustomer", () => {
    it("слой расширения — в сервис конфигураций; снятие по handle", async () => {
        const { service, peer } = setup();
        peer.notify("languages.setLanguageConfiguration", { handle: 0, languageId: "go", configuration: COMMENTS });
        peer.notify("languages.setLanguageConfiguration", { handle: 1, languageId: "go.mod", configuration: {} });
        await flushMicrotasks();
        expect(service.live).toEqual([
            { languageId: "go", configuration: COMMENTS },
            { languageId: "go.mod", configuration: {} },
        ]);

        peer.notify("languages.unsetLanguageConfiguration", { handle: 0 });
        peer.notify("languages.unsetLanguageConfiguration", { handle: 7 });
        peer.notify("languages.unsetLanguageConfiguration", { handle: "1" });
        await flushMicrotasks();
        expect(service.live.map((layer) => layer.languageId)).toEqual(["go.mod"]);
    });

    it("повтор handle заменяет слой, а не кладёт второй поверх", async () => {
        const { service, peer } = setup();
        peer.notify("languages.setLanguageConfiguration", { handle: 0, languageId: "go", configuration: COMMENTS });
        peer.notify("languages.setLanguageConfiguration", { handle: 0, languageId: "go", configuration: {} });
        await flushMicrotasks();
        expect(service.live).toEqual([{ languageId: "go", configuration: {} }]);
    });

    it("структурно чужое — игнорируется", async () => {
        const { service, peer } = setup();
        peer.notify("languages.setLanguageConfiguration", { languageId: "go", configuration: COMMENTS });
        await flushMicrotasks();
        expect(service.live).toEqual([]);
    });

    it("смерть субпроцесса снимает все его слои — уже снятые повторно не трогает", async () => {
        const { service, peer, spawn } = setup();
        peer.notify("languages.setLanguageConfiguration", { handle: 0, languageId: "go", configuration: COMMENTS });
        peer.notify("languages.setLanguageConfiguration", { handle: 1, languageId: "go", configuration: {} });
        peer.notify("languages.unsetLanguageConfiguration", { handle: 0 });
        await flushMicrotasks();
        expect(service.disposals.count).toBe(1);
        spawn.dispose();
        expect(service.live).toEqual([]);
        expect(service.disposals.count).toBe(2);
    });
});

describe("parseWireLanguageConfiguration", () => {
    it("форма с handle, языком и объектом-конфигурацией", () => {
        expect(parseWireLanguageConfiguration({ handle: 2, languageId: "go", configuration: COMMENTS })).toEqual({
            handle: 2,
            languageId: "go",
            configuration: COMMENTS,
        });
    });

    it.each([
        ["не объект", null],
        ["без handle", { languageId: "go", configuration: {} }],
        ["дробный handle", { handle: 1.5, languageId: "go", configuration: {} }],
        ["язык не строка", { handle: 1, languageId: 3, configuration: {} }],
        ["без конфигурации", { handle: 1, languageId: "go" }],
        ["конфигурация null", { handle: 1, languageId: "go", configuration: null }],
        ["конфигурация-массив", { handle: 1, languageId: "go", configuration: [] }],
        ["конфигурация-строка", { handle: 1, languageId: "go", configuration: "x" }],
    ])("%s — null", (_what, raw) => {
        expect(parseWireLanguageConfiguration(raw)).toBeNull();
    });
});
