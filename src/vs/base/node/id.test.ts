import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { getMac, getMachineId, type NetworkInterfaces } from "./id.ts";

const ifaces =
    (...macs: string[]): NetworkInterfaces =>
    () => ({ eth0: macs.map((mac) => ({ mac })) });

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

describe("getMac", () => {
    it("the first address that is not a placeholder", () => {
        expect(getMac(ifaces("00:00:00:00:00:00", "3c:22:fb:01:02:03", "aa:bb:cc:dd:ee:ff"))).toBe("3c:22:fb:01:02:03");
    });

    it("upstream placeholders are skipped in any case and with dashes", () => {
        expect(getMac(ifaces("FF-FF-FF-FF-FF-FF", "AC:DE:48:00:11:22", "00-00-00-00-00-00"))).toBeUndefined();
    });

    it("walks all interfaces; an interface without entries does not get in the way", () => {
        expect(
            getMac(() => ({
                lo: undefined,
                wlan0: [{ mac: "00:00:00:00:00:00" }],
                eth1: [{ mac: "02:42:ac:11:00:02" }],
            })),
        ).toBe("02:42:ac:11:00:02");
    });

    it("no interfaces: undefined", () => {
        expect(getMac(() => ({}))).toBeUndefined();
    });
});

describe("getMachineId", () => {
    it("sha256 of the MAC address in hex, as upstream", () => {
        expect(getMachineId(ifaces("3c:22:fb:01:02:03"))).toBe(sha256("3c:22:fb:01:02:03"));
    });

    it("the address is taken as is, without case normalization (otherwise the id would diverge from VS Code)", () => {
        expect(getMachineId(ifaces("3C:22:FB:01:02:03"))).toBe(sha256("3C:22:FB:01:02:03"));
    });

    it("without a MAC address: a fresh uuid each time (the caller's cache provides stability)", () => {
        const a = getMachineId(ifaces("00:00:00:00:00:00"));
        const b = getMachineId(ifaces());
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(b).not.toBe(a);
    });

    it("reads the machine's real interfaces by default", () => {
        expect(getMachineId()).toMatch(/^([0-9a-f]{64}|[0-9a-f-]{36})$/);
    });
});
