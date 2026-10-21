import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { URLService } from "./url.ts";

const uri = Uri.parse("diode://pub.ext/path");

describe("URLService", () => {
    it("without handlers the URL is not opened", async () => {
        await expect(new URLService().open(uri)).resolves.toBe(false);
    });

    it("handlers run in registration order until the first true; options are passed as is", async () => {
        const service = new URLService();
        const first = { handleURL: vi.fn(() => Promise.resolve(false)) };
        const second = { handleURL: vi.fn(() => Promise.resolve(true)) };
        const third = { handleURL: vi.fn(() => Promise.resolve(true)) };
        service.registerHandler(first);
        service.registerHandler(second);
        service.registerHandler(third);
        await expect(service.open(uri, { trusted: true })).resolves.toBe(true);
        expect(first.handleURL).toHaveBeenCalledWith(uri, { trusted: true });
        expect(second.handleURL).toHaveBeenCalledWith(uri, { trusted: true });
        expect(third.handleURL).not.toHaveBeenCalled();
    });

    it("all declined gives false", async () => {
        const service = new URLService();
        service.registerHandler({ handleURL: () => Promise.resolve(false) });
        await expect(service.open(uri)).resolves.toBe(false);
    });

    it("a removed handler is no longer asked", async () => {
        const service = new URLService();
        const handler = { handleURL: vi.fn(() => Promise.resolve(true)) };
        service.registerHandler(handler).dispose();
        await expect(service.open(uri)).resolves.toBe(false);
        expect(handler.handleURL).not.toHaveBeenCalled();
    });
});
