import { afterEach, describe, expect, it } from "vitest";

import { emulatorWith, fakeFileService } from "../../../../../../TestUtils/terminalLinks.ts";
import { createTestConfigurationService } from "../../../../../../TestUtils/testConfigurationService.ts";
import type { IEnvironmentService } from "../../../../../platform/environment/common/environment.ts";
import type { IFileService } from "../../../../../platform/files/common/files.ts";
import type { IWorkspaceContextService } from "../../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { ITerminalInstance } from "../../../terminal/browser/terminalService.ts";
import type { ExtensionPtySession } from "../../../terminal/node/extensionPtySession.ts";
import type { ITerminalLink } from "../common/terminalLinkProvider.ts";

import type { TerminalLinkOpener } from "./terminalLinkOpener.ts";
import { TerminalLinkService } from "./terminalLinkService.ts";

const ROWS = 8;

describe("TerminalLinkService", () => {
    let sessions: ExtensionPtySession[] = [];
    let opened: ITerminalLink[];

    afterEach(() => {
        for (const session of sessions) session.dispose();
        sessions = [];
    });

    function service(settings: Record<string, unknown> = {}): TerminalLinkService {
        opened = [];
        const opener = {
            open: (link: ITerminalLink) => {
                opened.push(link);
                return Promise.resolve();
            },
        } as unknown as TerminalLinkOpener;
        const workspace = {
            getWorkspace: () => ({ folders: [] }),
            getWorkspaceFolder: () => null,
        } as unknown as IWorkspaceContextService;
        return new TerminalLinkService(
            createTestConfigurationService(settings),
            fakeFileService({ "/ws/a.ts": "file" }) as IFileService,
            workspace,
            { userHome: "/home/user" } as IEnvironmentService,
            opener,
        );
    }

    async function instanceWith(output: string): Promise<ITerminalInstance> {
        const session = await emulatorWith(output, 20, ROWS);
        sessions.push(session);
        return { session, launch: { cwd: "/ws" } } as unknown as ITerminalInstance;
    }

    /** Before the emulator loads: no buffer yet. */
    function instanceWithoutBuffer(): ITerminalInstance {
        return { session: { buffer: undefined }, launch: { cwd: "/ws" } } as unknown as ITerminalInstance;
    }

    function linkAt(y: number): ITerminalLink {
        return { text: "a.ts", start: { x: 0, y }, end: { x: 4, y } } as unknown as ITerminalLink;
    }

    /** 40 numbered rows: the buffer has 41 rows, the viewport shows the last 8. */
    const OUTPUT = Array.from({ length: 40 }, (_, i) => String(i)).join("\r\n");

    describe("revealLink", () => {
        it("a link on screen, its top or bottom row included, doesn't scroll", async () => {
            const links = service();
            const instance = await instanceWith(OUTPUT);
            links.createWidget(instance);
            instance.session.scrollLines(-10);
            const top = instance.session.buffer!.viewportY;

            links.revealLink(instance, linkAt(top));
            expect(instance.session.buffer!.viewportY).toBe(top);
            links.revealLink(instance, linkAt(top + ROWS - 1));
            expect(instance.session.buffer!.viewportY).toBe(top);
        });

        it("a link off screen is scrolled to a quarter of the viewport from the top, above or below", async () => {
            const links = service();
            const instance = await instanceWith(OUTPUT);
            links.createWidget(instance);
            const bottom = instance.session.buffer!.viewportY;

            links.revealLink(instance, linkAt(20));
            expect(instance.session.buffer!.viewportY).toBe(18);

            // Just below the viewport, which shows rows 18..25.
            links.revealLink(instance, linkAt(26));
            expect(instance.session.buffer!.viewportY).toBe(24);

            // Near the start of the buffer it stops at the top.
            links.revealLink(instance, linkAt(1));
            expect(instance.session.buffer!.viewportY).toBe(0);

            links.revealLink(instance, linkAt(bottom + 2));
            expect(instance.session.buffer!.viewportY).toBe(bottom);
        });

        it("scrolls a terminal without a widget as well; undefined only clears the underline", async () => {
            const links = service();
            const instance = await instanceWith(OUTPUT);

            links.revealLink(instance, linkAt(20));
            expect(instance.session.buffer!.viewportY).toBe(18);
            links.revealLink(instance, undefined);
            expect(instance.session.buffer!.viewportY).toBe(18);
        });

        it("before the emulator has a buffer it does nothing", () => {
            const links = service();

            expect(() => {
                links.revealLink(instanceWithoutBuffer(), linkAt(20));
            }).not.toThrow();
        });
    });

    describe("getLinks", () => {
        it("before the emulator has a buffer: no links", async () => {
            const { viewport, all } = service().getLinks(instanceWithoutBuffer());

            expect(await viewport).toEqual({ fileLinks: [], folderLinks: [] });
            expect(await all).toEqual({ fileLinks: [], folderLinks: [] });
        });

        it('`enableFileLinks: "off"`: no links', async () => {
            const { viewport } = service({ "terminal.integrated.enableFileLinks": "off" }).getLinks(
                await instanceWith("a.ts"),
            );

            expect(await viewport).toEqual({ fileLinks: [], folderLinks: [] });
        });
    });

    describe("openRecentLink", () => {
        it("opens the bottom file link", async () => {
            const links = service();
            await links.openRecentLink(await instanceWith("a.ts"));

            expect(opened.map((link) => link.text)).toEqual(["a.ts"]);
        });

        it('opens nothing with `enableFileLinks: "off"` or before the emulator has a buffer', async () => {
            const off = service({ "terminal.integrated.enableFileLinks": "off" });
            await off.openRecentLink(await instanceWith("a.ts"));
            expect(opened).toEqual([]);

            const links = service();
            await links.openRecentLink(instanceWithoutBuffer());
            expect(opened).toEqual([]);
        });
    });
});
