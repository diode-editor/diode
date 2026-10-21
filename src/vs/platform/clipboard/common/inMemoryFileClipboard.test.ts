import { describe, expect, it, vi } from "vitest";

import { InMemoryFileClipboard } from "./inMemoryFileClipboard.ts";

describe("InMemoryFileClipboard", () => {
    it("starts empty", () => {
        expect(new InMemoryFileClipboard().read()).toBeNull();
    });

    it("stores written paths and mode (copied, not aliased)", () => {
        const clip = new InMemoryFileClipboard();
        const paths = ["/a", "/b"];
        clip.write(paths, "cut");
        paths.push("/c");

        expect(clip.read()).toEqual({ paths: ["/a", "/b"], mode: "cut" });
    });

    it("clear resets to empty", () => {
        const clip = new InMemoryFileClipboard();
        clip.write(["/a"], "copy");
        clip.clear();
        expect(clip.read()).toBeNull();
    });

    it("notifies listeners on write and clear", () => {
        const clip = new InMemoryFileClipboard();
        const listener = vi.fn();
        clip.onDidChange(listener);

        clip.write(["/a"], "copy");
        expect(listener).toHaveBeenLastCalledWith({ paths: ["/a"], mode: "copy" });

        clip.clear();
        expect(listener).toHaveBeenLastCalledWith(null);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("does not notify when clearing an already-empty clipboard", () => {
        const clip = new InMemoryFileClipboard();
        const listener = vi.fn();
        clip.onDidChange(listener);
        clip.clear();
        expect(listener).not.toHaveBeenCalled();
    });

    it("stops notifying after dispose", () => {
        const clip = new InMemoryFileClipboard();
        const listener = vi.fn();
        const sub = clip.onDidChange(listener);
        sub.dispose();
        clip.write(["/a"], "copy");
        expect(listener).not.toHaveBeenCalled();
    });

    it("dispose is idempotent and does not detach other listeners", () => {
        const clip = new InMemoryFileClipboard();
        const first = vi.fn();
        const second = vi.fn();
        const sub = clip.onDidChange(first);
        clip.onDidChange(second);

        sub.dispose();
        sub.dispose(); // a second dispose is a no-op and must not affect another subscription

        clip.write(["/a"], "copy");
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });
});
