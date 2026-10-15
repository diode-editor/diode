import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { getMac, getMachineId, type NetworkInterfaces } from "./id.ts";

const ifaces =
    (...macs: string[]): NetworkInterfaces =>
    () => ({ eth0: macs.map((mac) => ({ mac })) });

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

describe("getMac", () => {
    it("первый адрес, который не заглушка", () => {
        expect(getMac(ifaces("00:00:00:00:00:00", "3c:22:fb:01:02:03", "aa:bb:cc:dd:ee:ff"))).toBe("3c:22:fb:01:02:03");
    });

    it("заглушки эталона пропускаются в любом регистре и с дефисами", () => {
        expect(getMac(ifaces("FF-FF-FF-FF-FF-FF", "AC:DE:48:00:11:22", "00-00-00-00-00-00"))).toBeUndefined();
    });

    it("обходит все интерфейсы; интерфейс без записей не мешает", () => {
        expect(
            getMac(() => ({
                lo: undefined,
                wlan0: [{ mac: "00:00:00:00:00:00" }],
                eth1: [{ mac: "02:42:ac:11:00:02" }],
            })),
        ).toBe("02:42:ac:11:00:02");
    });

    it("без интерфейсов — undefined", () => {
        expect(getMac(() => ({}))).toBeUndefined();
    });
});

describe("getMachineId", () => {
    it("sha256 MAC-адреса в hex — как у эталона", () => {
        expect(getMachineId(ifaces("3c:22:fb:01:02:03"))).toBe(sha256("3c:22:fb:01:02:03"));
    });

    it("адрес берётся как есть, без нормализации регистра (иначе id разошёлся бы с VS Code)", () => {
        expect(getMachineId(ifaces("3C:22:FB:01:02:03"))).toBe(sha256("3C:22:FB:01:02:03"));
    });

    it("без MAC-адреса — uuid, каждый раз новый (стабильность даёт кэш вызывающего)", () => {
        const a = getMachineId(ifaces("00:00:00:00:00:00"));
        const b = getMachineId(ifaces());
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(b).not.toBe(a);
    });

    it("по умолчанию читает настоящие интерфейсы машины", () => {
        expect(getMachineId()).toMatch(/^([0-9a-f]{64}|[0-9a-f-]{36})$/);
    });
});
