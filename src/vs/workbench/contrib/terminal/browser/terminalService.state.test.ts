import { describe, expect, it } from "vitest";

import { FakeExtensionPtySession } from "../../../../../TestUtils/FakeExtensionPtySession.ts";
import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";

import { TerminalService } from "./terminalService.ts";

function buildHarness() {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    const service = new TerminalService(views.service, createTestConfigurationService({}), (options) => {
        const surface = new FakeTerminalSurface(options.shell ?? "/bin/bash");
        sessions.push(surface);
        return surface;
    });
    views.service.attachRegisteredContainers();
    const titles: string[] = [];
    service.onDidChangeInstanceTitle((i) => titles.push(`${String(i.id)}:${i.title}`));
    const interactions: number[] = [];
    service.onDidInteractWithInstance((i) => interactions.push(i.id));
    return { service, sessions, titles, interactions };
}

describe("TerminalService — state an extension sees", () => {
    it("shellType from the shell executable; unknown shell and an extension pty have none", () => {
        const h = buildHarness();
        const zsh = h.service.createInstance({ shellPath: "/usr/bin/zsh" });
        const custom = h.service.createInstance({ shellPath: "/opt/my-shell" });
        const pty = h.service.createInstance({
            session: new FakeExtensionPtySession({
                cols: 80,
                rows: 24,
                name: "bash",
                onInput: () => undefined,
                onResize: () => undefined,
            }),
        });
        expect([zsh.shellType, custom.shellType, pty.shellType]).toStrictEqual(["zsh", undefined, undefined]);
        h.service.dispose();
    });

    it("renameInstance: the new title wins over the given name and is reported once; same title or unknown id is silent", () => {
        const h = buildHarness();
        const instance = h.service.createInstance({ name: "foo" });
        h.service.renameInstance(instance.id, "bar");
        h.service.renameInstance(instance.id, "bar");
        h.service.renameInstance(99, "baz");
        expect(h.service.getInstance(instance.id)?.title).toBe("bar");
        expect(h.titles).toStrictEqual([`${String(instance.id)}:bar`]);
        h.service.dispose();
    });

    it("interaction: the first key or sendText per instance flips isInteractedWith and is reported once", () => {
        const h = buildHarness();
        const a = h.service.createInstance();
        const b = h.service.createInstance();
        const c = h.service.createInstance({ waitOnExit: true });
        expect(a.isInteractedWith).toBe(false);
        h.sessions[0].write("x");
        h.sessions[0].write("y");
        h.service.sendText(b.id, "ls", true);
        expect(h.interactions).toStrictEqual([a.id, b.id]);
        expect([a.isInteractedWith, b.isInteractedWith, c.isInteractedWith]).toStrictEqual([true, true, false]);
        // A key after exit only closes the waiting terminal: it never reached a process.
        h.sessions[2].isExited = true;
        h.sessions[2].emitExit(0);
        h.sessions[2].write("x");
        expect(h.interactions).toStrictEqual([a.id, b.id]);
        h.service.dispose();
    });

    it("relaunch re-guesses the shell type from the new executable", () => {
        const h = buildHarness();
        const instance = h.service.createInstance({ shellPath: "/bin/bash", waitOnExit: true });
        h.sessions[0].isExited = true;
        h.sessions[0].emitExit(0);
        h.sessions[0].shell = "/usr/bin/fish";
        h.service.relaunchInstance(instance.id, { shellPath: "/usr/bin/fish" });
        expect(h.service.getInstance(instance.id)?.shellType).toBe("fish");
        h.service.dispose();
    });
});
