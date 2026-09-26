import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type HeadlessApp, removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findTextCell, frameToText } from "./helpers/frame.ts";
import { findNode } from "./helpers/inspectorClient.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Темы от расширений (`contributes.themes`, docs/TODO/Theming.md) на настоящем
 * бинаре: расширение-тема ставится тем же CLI-путём, что у пользователя
 * (`--install-extension <vsix>` из файлового реестра-фикстуры, упакованного
 * продовым `scripts/pack-vsix.mjs`), а проверяется кадр — цвет ячейки фона
 * редактора / статус-бара равен `editor.background` / `statusBar.background`
 * из файла темы, а не «в реестре есть запись».
 *
 * Порядок старта (`main.ts`: сканирование → регистрация тем → выбор активной)
 * закрывается здесь, а не юнитом: продюсер порядка — сам main.ts.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE_SOURCE = resolve(here, "fixtures", "sample-theme");

/** Цвета из e2e/fixtures/sample-theme/themes/*.json. */
const SAMPLE_DARK = { editorBg: 0x101820, statusBg: 0x0a0f14, keywordFg: 0xff7b72 };
const SAMPLE_LIGHT = { editorBg: 0xfafaf5, statusBg: 0xdde3e9 };
/** Dark Modern (дефолт при ненайденной теме). */
const DARK_MODERN = { editorBg: 0x1f1f1f, statusBg: 0x181818 };

const SAMPLE_FILE = "sample.ts";
const SAMPLE_CONTENT = "const answer = 42;\n// second line\n";

let registryRoot: string;
let sampleVsix: string;

function statusBarBg(frame: GridSnapshot): number {
    const y = frame.rows - 1;
    return frame.cells[y * frame.cols].bg;
}

/** Фон ячейки редактора на второй строке документа (первая — под кареткой и occurrence-подсветкой). */
async function editorBg(app: HeadlessApp, frame: GridSnapshot): Promise<number> {
    const root = (await app.session.getDocument()).root;
    const editor = findNode(root, (n) => n.type === "EditorElement");
    if (editor === null) throw new Error("EditorElement не найден в дереве");
    const x = editor.box.x + editor.box.width - 2;
    const y = editor.box.y + 1;
    return frame.cells[y * frame.cols + x].bg;
}

describe("Extension themes (e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        registryRoot = mkdtempSync(join(tmpdir(), "diode-theme-registry-"));
        const registry = await createRegistryFixture(join(registryRoot, "registry"), [
            { id: "test.sample-theme", version: "0.0.1", sourceDir: SAMPLE_SOURCE },
        ]);
        sampleVsix = join(registry, "artifacts", "test.sample-theme-0.0.1.vsix");
    }, 300_000);

    afterAll(() => {
        removeTempDir(registryRoot);
    });

    it("US-3/US-8: тема расширения из settings.json — первый кадр уже в ней, подсветка синтаксиса из её tokenColors", async () => {
        const app = await useHeadlessApp({
            installVsix: [sampleVsix],
            settings: { "workbench.colorTheme": "Sample Dark" },
            files: { [SAMPLE_FILE]: SAMPLE_CONTENT },
            open: [".", SAMPLE_FILE],
        });

        // Первый захваченный кадр, в котором вообще что-то нарисовано, — и все
        // последующие до устоявшегося: ни один не в Dark Modern.
        const observed: number[] = [];
        const first = await waitUntil(
            () => app.session.captureFrame(),
            (frame) => {
                const bg = statusBarBg(frame);
                if (bg >= 0) observed.push(bg);
                return bg >= 0;
            },
            { describe: "первый нарисованный кадр", intervalMs: 5 },
        );
        expect(statusBarBg(first)).toBe(SAMPLE_DARK.statusBg);
        expect(observed).not.toContain(DARK_MODERN.statusBg);

        const settled = await app.session.waitForText((t) => t.includes("const answer"));
        expect(statusBarBg(settled)).toBe(SAMPLE_DARK.statusBg);
        expect(await editorBg(app, settled)).toBe(SAMPLE_DARK.editorBg);

        // US-8: `const` — правило `storage`/`keyword` темы расширения.
        const keyword = findTextCell(settled, "const answer");
        expect(keyword).not.toBeNull();
        expect(settled.cells[keyword!.y * settled.cols + keyword!.x].fg).toBe(SAMPLE_DARK.keywordFg);
    });

    it("US-5: тема из настроек не установлена — окно в Dark Modern, настройка не переписана", async () => {
        const app = await useHeadlessApp({
            settings: { "workbench.colorTheme": "Sample Dark" },
            files: { [SAMPLE_FILE]: SAMPLE_CONTENT },
            open: [".", SAMPLE_FILE],
        });
        const frame = await app.session.waitForText((t) => t.includes("const answer"));

        expect(statusBarBg(frame)).toBe(DARK_MODERN.statusBg);
        expect(await editorBg(app, frame)).toBe(DARK_MODERN.editorBg);
        const settings = readFileSync(join(app.env.userDataDir, "user-data", "User", "settings.json"), "utf8");
        expect(JSON.parse(settings)).toEqual({ "workbench.colorTheme": "Sample Dark" });
    });

    it("US-7: правка workbench.colorTheme в settings.json перекрашивает окно в тему расширения без рестарта", async () => {
        const app = await useHeadlessApp({
            installVsix: [sampleVsix],
            files: { [SAMPLE_FILE]: SAMPLE_CONTENT },
            open: [".", SAMPLE_FILE],
        });
        const before = await app.session.waitForText((t) => t.includes("const answer"));
        expect(statusBarBg(before)).toBe(DARK_MODERN.statusBg);

        writeFileSync(
            join(app.env.userDataDir, "user-data", "User", "settings.json"),
            JSON.stringify({ "workbench.colorTheme": "Sample Light" }, null, 2),
        );

        const after = await waitUntil(
            () => app.session.captureFrame(),
            (frame) => statusBarBg(frame) === SAMPLE_LIGHT.statusBg,
            { describe: "перекрас в Sample Light по правке settings.json", timeoutMs: 20_000 },
        );
        expect(await editorBg(app, after)).toBe(SAMPLE_LIGHT.editorBg);
        expect(frameToText(after)).toContain("const answer");
    });
});
