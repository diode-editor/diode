import { readFileSync } from "node:fs";
import { join } from "node:path";

import iconv from "iconv-lite";
import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Кодировки на SEA-бинаре. iconv-lite — ленивый кусок бандла `lazy/iconv-lite.cjs`:
 * в `main.cjs` его нет, utf-8 и UTF-16 идут нативно, а кусок грузится на первом
 * Reopen with Encoding в однобайтной кодировке. Упакованная сборка без куска
 * упала бы на запасном `import("iconv-lite")` — пакета рядом нет, — поэтому
 * проверяется именно бинарь: правка и запись байт в байт, ошибок в Bootstrap нет
 * (отказ кэша кода куска ушёл бы туда непредвиденной ошибкой).
 */

const TEXT = "Привет, мир!\n";

/** «Change File Encoding» → режим → кодировка, как человек: F1, фильтр, Enter. */
async function changeEncoding(session: HeadlessSession, mode: string, encodingLabel: string): Promise<void> {
    await session.sendKey("F1");
    await session.waitForNode("#quickInput");
    await session.sendText("Change File Encoding");
    await session.waitForText((t) => t.includes("Change File Encoding"));
    await session.sendKey("Enter");
    await session.waitForText((t) => t.includes(mode));
    await session.sendText(mode);
    await session.sendKey("Enter");
    await session.waitForText((t) => t.includes("Select File Encoding"));
    await session.sendText(encodingLabel);
    await session.waitForText((t) => t.includes(encodingLabel));
    await session.sendKey("Enter");
}

async function expectBytesOnDisk(file: string, expected: Buffer): Promise<void> {
    await waitUntil(
        () => readFileSync(file),
        (bytes) => bytes.equals(expected),
        { describe: `байты ${file}`, diagnose: (last) => (last as Buffer).toString("hex") },
    );
}

async function expectNoBootstrapErrors(session: HeadlessSession): Promise<void> {
    const bootstrap = await session.getOutput("bootstrap");
    expect(bootstrap).not.toContain("unexpected error");
    expect(bootstrap).not.toContain("unhandled rejection");
}

describe("кодировки на SEA: iconv — ленивый кусок", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("windows-1251: Reopen with Encoding, правка, запись байт в байт", async () => {
        const { session, env } = await useHeadlessApp({
            files: { "cp.txt": iconv.encode(TEXT, "windows1251") },
            open: ["cp.txt"],
        });
        await session.waitForText((t) => t.includes("UTF-8"));

        await changeEncoding(session, "Reopen with Encoding", "Windows 1251");
        await session.waitForText((t) => t.includes("Привет, мир!") && t.includes("Windows 1251"));

        await session.sendText("Ёж ");
        await session.waitForText((t) => t.includes("Ёж Привет"));
        await session.executeCommand("workbench.action.files.save");
        await expectBytesOnDisk(join(env.workspaceDir, "cp.txt"), iconv.encode(`Ёж ${TEXT}`, "windows1251"));

        await expectNoBootstrapErrors(session);
    }, 120_000);

    it("UTF-16 LE с BOM: открытие по BOM, правка, запись с BOM", async () => {
        const bom = Buffer.from([0xff, 0xfe]);
        const { session, env } = await useHeadlessApp({
            files: { "u16.txt": Buffer.concat([bom, Buffer.from(TEXT, "utf16le")]) },
            open: ["u16.txt"],
        });
        await session.waitForText((t) => t.includes("Привет, мир!") && t.includes("UTF-16 LE"));

        await session.sendText("Ёж ");
        await session.waitForText((t) => t.includes("Ёж Привет"));
        await session.executeCommand("workbench.action.files.save");
        await expectBytesOnDisk(join(env.workspaceDir, "u16.txt"), Buffer.concat([bom, Buffer.from(`Ёж ${TEXT}`, "utf16le")]));

        await expectNoBootstrapErrors(session);
    }, 120_000);

    it("Save with Encoding в KOI8-R из utf-8", async () => {
        const { session, env } = await useHeadlessApp({ files: { "plain.txt": TEXT }, open: ["plain.txt"] });
        await session.waitForText((t) => t.includes("Привет, мир!") && t.includes("UTF-8"));

        await changeEncoding(session, "Save with Encoding", "KOI8-R");
        await expectBytesOnDisk(join(env.workspaceDir, "plain.txt"), iconv.encode(TEXT, "koi8r"));
        await session.waitForText((t) => t.includes("KOI8-R"));

        await expectNoBootstrapErrors(session);
    }, 120_000);
});
