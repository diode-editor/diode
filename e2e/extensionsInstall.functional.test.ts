import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Функциональный e2e установки из магазина: настоящий бинарь, настоящий `.vsix`
 * в файловом реестре-фикстуре, настоящая распаковка на диск и перезагрузка окна.
 *
 * Реестр герметичен (`--registry <каталог>`), но артефакты в нём — те же, что
 * раздаёт публичный магазин: пакует их продовый `scripts/pack-vsix.mjs`. Сеть
 * проверяет отдельный сьют `e2e/marketplace/`.
 *
 * Расширение фикстуры декларативное (`kind: "native"`, язык + грамматика,
 * без кода): его вклад виден в статус-баре, поэтому «работает после
 * перезагрузки» проверяется наблюдаемым эффектом, а не фактом файла на диске.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE_SOURCE = resolve(here, "marketplace", "sample-extension");

/** F6 — вьюлет магазина: настоящий Ctrl+Shift+X e2e-DSL не кодирует. */
const KEYS = [{ key: "f6", command: "workbench.view.extensions" }];

const SAMPLE_FILE = "sample.diodesample";

/** Карточки реестра: имена и описания, не пересекающиеся с именем языка. */
const NAMES = {
    sample: { displayName: "Sample Lang", description: "Fixture language", readme: "Sample language readme" },
    legacy: { displayName: "Legacy Thing", description: "Needs a newer API" },
    broken: { displayName: "Broken Artifact", description: "Its bytes do not match the registry" },
} as const;

let registryRoot: string;
let registry: string;

async function openExtensions(options: { installVsix?: string[] } = {}): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { [SAMPLE_FILE]: "sample marketplace 42\n" },
        open: [".", SAMPLE_FILE],
        extraArgs: [`--registry=${registry}`],
        keybindings: KEYS,
        installVsix: options.installVsix,
        cols: 110,
        rows: 30,
    });
    await app.session.waitForText((t) => t.includes("EXPLORER"));
    await app.session.key("F6");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
    return app;
}

/** Открывает страницу расширения: фильтр по запросу → Enter на первой записи. */
async function openPage(app: HeadlessApp, query: string, pageId: string): Promise<void> {
    await app.session.text(query);
    await app.session.key("Tab");
    await app.session.key("ArrowDown");
    await app.session.key("Enter");
    await app.session.waitForNode(`#extensionPage-${pageId}`);
}

/** Кнопки страницы как их видит пользователь: подпись и доступность. */
async function pageButtons(app: HeadlessApp): Promise<{ label: string; enabled: boolean }[]> {
    const header = await app.session.node("#extensionPageHeader");
    const state = header?.state as { buttons?: { label: string; enabled: boolean }[] } | undefined;
    return state?.buttons ?? [];
}

/** Каталоги установленных расширений в user-data-dir сессии. */
function installedDirs(app: HeadlessApp): string[] {
    const dir = join(app.env.userDataDir, "extensions");
    return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe("Extensions install (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        registryRoot = mkdtempSync(join(tmpdir(), "diode-registry-fixture-"));
        registry = await createRegistryFixture(join(registryRoot, "registry"), [
            // Две версии одного расширения: установка старой и обновление до новой.
            // Имена карточек намеренно не содержат «Diode Sample»: это имя языка
            // из вклада расширения, и по нему проверяется работа после перезагрузки.
            { id: "test.sample-lang", version: "0.0.1", sourceDir: SAMPLE_SOURCE, ...NAMES.sample },
            { id: "test.sample-lang", version: "0.0.2", sourceDir: SAMPLE_SOURCE, ...NAMES.sample },
            { id: "old.legacy", version: "3.0.0", sourceDir: SAMPLE_SOURCE, engines: { vscode: "^99.0.0" }, ...NAMES.legacy },
            { id: "broken.artifact", version: "1.0.0", sourceDir: SAMPLE_SOURCE, corruptSha: true, ...NAMES.broken },
        ]);
    }, 300_000);

    afterAll(() => {
        removeTempDir(registryRoot);
    });

    it("US-11/12: кнопка Install ставит расширение на диск и зовёт перезагрузить окно", async () => {
        const app = await openExtensions();
        await openPage(app, "sample", "test-sample-lang");
        expect(await pageButtons(app)).toEqual([{ label: "Install", enabled: true }]);

        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Installed 0.0.2"));

        expect(await pageButtons(app)).toEqual([
            { label: "Reload Window", enabled: true },
            { label: "Uninstall", enabled: true },
        ]);
        expect(installedDirs(app)).toEqual(["test.sample-lang-0.0.2"]);
        expect(existsSync(join(app.env.userDataDir, "extensions", "test.sample-lang-0.0.2", "package.json"))).toBe(true);
        // Сообщение о результате — в статус-баре, рядом с тем же приглашением.
        expect(frameToText(await app.session.captureFrame())).toContain("reload window to activate");
    });

    it("US-13: после перезагрузки окна вклад расширения работает", async () => {
        const app = await openExtensions();
        // До установки язык неизвестен: `.diodesample` — обычный текст.
        expect(frameToText(await app.session.captureFrame())).not.toContain("Diode Sample");

        await openPage(app, "sample", "test-sample-lang");
        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Reload Window"));

        // Ответа на этот ввод не будет: окно уходит на перезапуск вместе с сокетом.
        await app.session.sendKey("Enter").catch(() => undefined);
        await app.session.reconnect();

        // Новое окно: те же аргументы, восстановленная сессия и — главное —
        // язык из установленного расширения.
        await app.session.waitForText((t) => t.includes("Diode Sample"), { timeoutMs: 60_000 });
    });

    it("US-14: у установленного старой версии кнопка обновляет до реестровой", async () => {
        const app = await openExtensions({
            installVsix: [join(registry, "artifacts", "test.sample-lang-0.0.1.vsix")],
        });
        await openPage(app, "sample", "test-sample-lang");
        expect(await pageButtons(app)).toEqual([
            { label: "Update to 0.0.2", enabled: true },
            { label: "Uninstall", enabled: true },
        ]);

        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Installed 0.0.2"));

        // Старая версия снесена установкой — на диске ровно один каталог.
        expect(installedDirs(app)).toEqual(["test.sample-lang-0.0.2"]);
    });

    it("US-15: Uninstall убирает расширение с диска", async () => {
        const app = await openExtensions({
            installVsix: [join(registry, "artifacts", "test.sample-lang-0.0.1.vsix")],
        });
        await openPage(app, "sample", "test-sample-lang");
        await app.session.key("ArrowRight"); // с «Update to …» на «Uninstall»
        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Not installed"));

        expect(installedDirs(app)).toEqual([]);
        expect(frameToText(await app.session.captureFrame())).toContain("reload window to apply");
    });

    it("US-16: несовместимое не ставится — кнопка есть, но выключена", async () => {
        const app = await openExtensions();
        await openPage(app, "legacy", "old-legacy");

        expect(await pageButtons(app)).toEqual([{ label: "Install", enabled: false }]);
        const screen = frameToText(await app.session.captureFrame());
        expect(screen).toContain("Incompatible with this build of Diode");
        // Почему — рядом: требование записи реестра.
        expect(screen).toContain("Requires: vscode ^99.0.0");
    });

    it("US-17: битый артефакт не ставится, причина видна, на диске пусто", async () => {
        const app = await openExtensions();
        await openPage(app, "broken", "broken-artifact");

        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("sha256 mismatch"));

        expect(installedDirs(app)).toEqual([]);
        // Кнопка снова доступна — повторить можно тут же.
        expect(await pageButtons(app)).toEqual([{ label: "Install", enabled: true }]);
    });
});
