import { describe, expect, it } from "vitest";

import { readUInt32BE, writeUInt32BE } from "./buffer.ts";

describe("buffer: uint32 big-endian", () => {
    it("пишет старший байт первым", () => {
        const bytes = new Uint8Array(6);
        writeUInt32BE(bytes, 0x01_02_03_04, 1);
        expect([...bytes]).toEqual([0, 1, 2, 3, 4, 0]);
    });

    it("читает то, что записано, включая значения со старшим битом", () => {
        const bytes = new Uint8Array(8);
        writeUInt32BE(bytes, 0xff_ee_dd_cc, 0);
        writeUInt32BE(bytes, 7, 4);
        expect(readUInt32BE(bytes, 0)).toBe(0xff_ee_dd_cc);
        expect(readUInt32BE(bytes, 4)).toBe(7);
    });

    it("читает байты по их разрядам", () => {
        expect(readUInt32BE(new Uint8Array([0x80, 0x40, 0x20, 0x10]), 0)).toBe(0x80_40_20_10);
    });
});
