import { existsSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { REGISTRY_SCHEMA_VERSION } from "../../src/vs/platform/extensionManagement/common/registryFormat.ts";
import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";
import { MARKETPLACE_CHECKS } from "./checks.ts";
import { createMarketplaceRoot, fetchPublishedIndex, PUBLISHED_REGISTRY_URL, runCli } from "./harness.ts";

/**
 * Прогон магазина на текущем коде: берём **всё, что сейчас опубликовано** в
 * реестре (`https://diode-editor.github.io/registry/v1/`), ставим последнюю
 * версию каждой записи настоящим бинарём и смотрим, что она работает. Отвечает
 * на два вопроса разом: жив ли магазин и не сломало ли очередное изменение diode
 * расширения, которые в нём лежат.
 *
 * Кейсы порождаются из живого каталога, а не из таблицы наших чеков: новая
 * запись в магазине попадает под прогон сама, без правок здесь. Поведенческий
 * смоук добавляется там, где он у нас написан (`checks.ts`) — его отсутствие
 * ничего не блокирует: что лежит в магазине, решает магазин, мы его состав
 * тестом не полицейским.
 *
 * Сьют зависит от сети и от состояния публикации, то есть может шуметь, и это
 * принято сознательно: он краснеет ровно тогда, когда пользователь получил бы
 * нерабочий магазин. Ретраев нет — они прятали бы этот сигнал.
 * `DIODE_E2E_OFFLINE=1` пропускает сьют при работе без сети; в CI переменная не
 * выставляется.
 */

const OFFLINE = process.env.DIODE_E2E_OFFLINE === "1";

// Каталог нужен на этапе сбора тестов — по кейсу на расширение, чтобы в отчёте
// было видно, какое именно отвалилось, а не «магазин сломался».
const catalog = OFFLINE ? undefined : await fetchPublishedIndex();
const published = catalog?.index.extensions ?? [];

describe.skipIf(OFFLINE)("магазин — опубликованные расширения на текущем коде", () => {
    let binary: string;

    beforeAll(async () => {
        binary = await getBinaryPath();
    }, 180_000);

    it("опубликованный индекс читается парсером клиента без замечаний", () => {
        // Опубликованное собирает скрипт в репозитории сайта, наших типов не
        // видящий: разбор нормативным парсером — единственная проверка того, что
        // его упрощённые правила не разошлись с форматом.
        expect(catalog?.problems).toEqual([]);
        expect(catalog?.index.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
        expect(published.length).toBeGreaterThan(0);
    });

    for (const entry of published) {
        const check = MARKETPLACE_CHECKS.find((c) => c.id === entry.id);
        // Глубина проверки видна прямо в имени кейса: у записи без чека прогон
        // доходит до распаковки и на этом честно останавливается.
        const what = check === undefined ? "ставится из магазина" : "ставится из магазина и работает в редакторе";
        it(
            `${entry.id}@${entry.latest.version} ${what}`,
            async () => {
                const { root, userDataDir } = createMarketplaceRoot();
                try {
                    const install = await runCli(binary, [
                        "--user-data-dir",
                        userDataDir,
                        "--registry",
                        PUBLISHED_REGISTRY_URL,
                        "--install-extension",
                        entry.id,
                    ]);
                    expect(install.stderr).toBe("");
                    expect(install.code).toBe(0);
                    // Ставится именно последняя опубликованная версия: реестр может
                    // обогнать редактор, и несовместимость видна здесь, а не у пользователя.
                    expect(install.stdout).toContain(`Installed ${entry.id}@${entry.latest.version}`);

                    const extDir = join(userDataDir, "extensions", `${entry.id}-${entry.latest.version}`);
                    expect(existsSync(join(extDir, "package.json")), `манифест не распакован в ${extDir}`).toBe(true);

                    // Поведенческая половина — не на Windows: там ext-host-сьюты
                    // репозитория и так выключены (`editorconfig-stock`), и красная
                    // проверка расширения означала бы известный пробел платформы, а не
                    // поломку магазина. Транспорт, sha256 и распаковка проверены выше
                    // на всех платформах.
                    if (check !== undefined && process.platform !== "win32") {
                        for (const rel of check.expectFiles) {
                            expect(existsSync(join(extDir, rel)), `${rel} не распакован в ${extDir}`).toBe(true);
                        }
                        await check.run({ root });
                    }
                } finally {
                    removeTempDir(root);
                }
            },
            240_000,
        );
    }

    it("--install-extension без --registry идёт в публичный реестр", async () => {
        // Дефолт клиента и есть магазин: пользователю не нужно знать адрес.
        const entry = published.find((e) => e.kind === "native") ?? published[0];
        const { root, userDataDir } = createMarketplaceRoot();
        try {
            const install = await runCli(binary, ["--user-data-dir", userDataDir, "--install-extension", entry.id]);
            expect(install.stderr).toBe("");
            expect(install.code).toBe(0);
            expect(install.stdout).toContain(`Installed ${entry.id}@${entry.latest.version}`);
        } finally {
            removeTempDir(root);
        }
    }, 180_000);
});
