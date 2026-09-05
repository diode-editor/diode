import { existsSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
    REGISTRY_SCHEMA_VERSION,
    type IRegistryIndex,
} from "../../src/vs/platform/extensionManagement/common/registryFormat.ts";
import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";
import { MARKETPLACE_CHECKS } from "./checks.ts";
import { createMarketplaceRoot, fetchPublishedIndex, PUBLISHED_REGISTRY_URL, runCli } from "./harness.ts";

/**
 * Полный цикл магазина против НАСТОЯЩЕГО опубликованного реестра
 * (`https://diode-editor.github.io/registry/v1/`): индекс и мета по сети → артефакт
 * (наш с Pages либо чужой с open-vsx) → sha256 → установка собранным бинарём →
 * запуск редактора → проверка функциональности расширения.
 *
 * Сьют зависит от сети и от состояния публикации — и это сознательно: он краснеет
 * ровно тогда, когда пользователь получил бы нерабочий магазин (сломанная
 * публикация, уехавший артефакт, регресс совместимости нашего API-шима). Гасить
 * шум ретраями значит прятать этот сигнал. `DIODE_E2E_OFFLINE=1` пропускает сьют
 * при работе без сети; в CI переменная не выставляется.
 */

const OFFLINE = process.env.DIODE_E2E_OFFLINE === "1";

describe.skipIf(OFFLINE)("marketplace — полный цикл против опубликованного реестра", () => {
    let binary: string;
    let index: IRegistryIndex;

    beforeAll(async () => {
        binary = await getBinaryPath();
        const published = await fetchPublishedIndex();
        // Опубликованное собирает скрипт в репозитории сайта, наших типов не
        // видящий: разбор нормативным парсером — единственная проверка того, что
        // его упрощённые правила не разошлись с форматом.
        expect(published.problems).toEqual([]);
        index = published.index;
    }, 180_000);

    it("опубликованный индекс читается парсером клиента", () => {
        expect(index.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
        expect(index.extensions.length).toBeGreaterThan(0);
    });

    it("у каждой опубликованной записи есть смоук-чек", () => {
        const published = index.extensions.map((e) => e.id).sort();
        const checked = MARKETPLACE_CHECKS.map((c) => c.id).sort();
        expect(checked).toEqual(published);
    });

    for (const check of MARKETPLACE_CHECKS) {
        it(
            `${check.id} ставится из реестра и работает в редакторе`,
            async () => {
                const entry = index.extensions.find((e) => e.id === check.id);
                if (entry === undefined) {
                    throw new Error(`${check.id} нет в опубликованном индексе`);
                }
                const { root, userDataDir } = createMarketplaceRoot();
                try {
                    const install = await runCli(binary, [
                        "--user-data-dir",
                        userDataDir,
                        "--registry",
                        PUBLISHED_REGISTRY_URL,
                        "--install-extension",
                        check.id,
                    ]);
                    expect(install.stderr).toBe("");
                    expect(install.code).toBe(0);
                    // Версия сверяется с индексом: обновление записи в реестре без
                    // зелёного прогона здесь не проходит незамеченным.
                    expect(install.stdout).toContain(`Installed ${check.id}@${entry.latest.version}`);

                    const extDir = join(userDataDir, "extensions", `${check.id}-${entry.latest.version}`);
                    for (const rel of check.expectFiles) {
                        expect(existsSync(join(extDir, rel)), `${rel} не распакован в ${extDir}`).toBe(true);
                    }

                    // Поведенческая половина — не на Windows: там ext-host-сьюты
                    // репозитория и так выключены (`editorconfig-stock`), и красная
                    // проверка расширения означала бы известный пробел платформы, а не
                    // поломку магазина. Транспорт, sha256 и распаковка проверены выше
                    // на всех платформах — это и есть новый код шага.
                    if (process.platform !== "win32") {
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
        const entry = index.extensions.find((e) => e.kind === "native") ?? index.extensions[0];
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
