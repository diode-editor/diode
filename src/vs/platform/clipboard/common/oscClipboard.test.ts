import { describe, expect, it, vi } from "vitest";

import { OscClipboard } from "./oscClipboard.ts";

describe("OscClipboard", () => {
    it("writeText calls writeFn with OSC 52 sequence", async () => {
        const writeFn = vi.fn();
        const clipboard = new OscClipboard(writeFn);
        await clipboard.writeText("hello");
        expect(writeFn).toHaveBeenCalledOnce();
        expect(writeFn).toHaveBeenCalledWith("\x1b]52;c;aGVsbG8=\x07");
    });

    it("readText returns the last written text", async () => {
        const clipboard = new OscClipboard(vi.fn());
        await clipboard.writeText("hello");
        expect(await clipboard.readText()).toBe("hello");
    });

    it("readText returns empty string initially", async () => {
        const clipboard = new OscClipboard(vi.fn());
        expect(await clipboard.readText()).toBe("");
    });

    it("writeText overwrites previous value in buffer", async () => {
        const clipboard = new OscClipboard(vi.fn());
        await clipboard.writeText("first");
        await clipboard.writeText("second");
        expect(await clipboard.readText()).toBe("second");
    });

    it("correctly base64-encodes unicode text", async () => {
        const writeFn = vi.fn();
        const clipboard = new OscClipboard(writeFn);
        const text = "\u041f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440"; // "Privet mir"
        await clipboard.writeText(text);
        const expected = Buffer.from(text, "utf8").toString("base64");
        expect(writeFn).toHaveBeenCalledWith(`\x1b]52;c;${expected}\x07`);
    });

    it("correctly encodes multi-line text", async () => {
        const writeFn = vi.fn();
        const clipboard = new OscClipboard(writeFn);
        const text = "line one\nline two\nline three";
        await clipboard.writeText(text);
        const expected = Buffer.from(text, "utf8").toString("base64");
        expect(writeFn).toHaveBeenCalledWith(`\x1b]52;c;${expected}\x07`);
        expect(await clipboard.readText()).toBe(text);
    });

    it("encodes an empty string to an empty base64 payload", async () => {
        const writeFn = vi.fn();
        const clipboard = new OscClipboard(writeFn);
        await clipboard.writeText("");
        expect(writeFn).toHaveBeenCalledWith("\x1b]52;c;\x07");
        expect(await clipboard.readText()).toBe("");
    });

    it("writeText resolves its promise", async () => {
        const clipboard = new OscClipboard(vi.fn());
        await expect(clipboard.writeText("x")).resolves.toBeUndefined();
    });

    it("readText never writes to the terminal (no OSC 52 read query)", async () => {
        const writeFn = vi.fn();
        const clipboard = new OscClipboard(writeFn);
        await clipboard.readText();
        await clipboard.writeText("copied");
        writeFn.mockClear();
        // Even after a write populated the buffer, reading it must stay terminal-free.
        await clipboard.readText();
        expect(writeFn).not.toHaveBeenCalled();
    });

    it("round-trips copy→paste through the internal register without a read query", async () => {
        const writeFn = vi.fn();
        const clipboard = new OscClipboard(writeFn);
        await clipboard.writeText("payload");
        // The only emitted sequence is the OSC 52 write — never the `?` read query.
        expect(writeFn).toHaveBeenCalledOnce();
        expect(writeFn).toHaveBeenCalledWith("\x1b]52;c;cGF5bG9hZA==\x07");
        expect(await clipboard.readText()).toBe("payload");
    });
});
