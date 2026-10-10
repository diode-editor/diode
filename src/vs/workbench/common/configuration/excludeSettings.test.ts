import { describe, expect, it } from "vitest";

import { ConfigurationModel } from "../../../platform/configuration/common/configurationModel.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";

import { CONFIGURATION_CONTRIBUTIONS } from "./configurationContributions.ts";
import {
    FILES_EXCLUDE_SETTING,
    filesExcludeGlobs,
    type IExcludeConfigReader,
    isExcludedPath,
    parseExcludeSetting,
    readUseIgnoreFiles,
    SEARCH_EXCLUDE_SETTING,
    SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING,
    SEARCH_USE_IGNORE_FILES_SETTING,
    SEARCH_USE_PARENT_IGNORE_FILES_SETTING,
    searchExcludeGlobs,
    WATCHER_EXCLUDE_SETTING,
    watcherExcludeGlobs,
} from "./excludeSettings.ts";

/** Читатель поверх карты значений — структурный аналог обоих настоящих. */
function reader(values: Readonly<Record<string, unknown>>): IExcludeConfigReader {
    return { get: (key: string): unknown => values[key] };
}

describe("parseExcludeSetting", () => {
    it("берёт только включённые шаблоны", () => {
        expect(parseExcludeSetting({ "a/**": true, "b/**": false, "c/**": true })).toEqual(["a/**", "c/**"]);
    });

    it("не-карта даёт пустой набор", () => {
        expect(parseExcludeSetting(undefined)).toEqual([]);
        expect(parseExcludeSetting(null)).toEqual([]);
        expect(parseExcludeSetting(["a/**"])).toEqual([]);
        expect(parseExcludeSetting("a/**")).toEqual([]);
    });

    it("значения кроме true не включают шаблон", () => {
        expect(parseExcludeSetting({ "a/**": 1, "b/**": "yes" })).toEqual([]);
    });
});

describe("сборки наборов по потребителям", () => {
    const config = reader({
        [FILES_EXCLUDE_SETTING]: { "**/.git": true, "**/off": false },
        [SEARCH_EXCLUDE_SETTING]: { "**/node_modules": true },
        [WATCHER_EXCLUDE_SETTING]: { "**/dist": true },
    });

    it("files.exclude — только свой ключ", () => {
        expect(filesExcludeGlobs(config)).toEqual(["**/.git"]);
    });

    it("поиск складывает files.exclude и search.exclude, в этом порядке", () => {
        expect(searchExcludeGlobs(config)).toEqual(["**/.git", "**/node_modules"]);
    });

    it("watcher живёт на своём наборе и соседей не видит", () => {
        expect(watcherExcludeGlobs(config)).toEqual(["**/dist"]);
    });

    it("search.exclude дополняет, а не заменяет: `files.exclude` остаётся в поиске", () => {
        const onlySearch = reader({ [SEARCH_EXCLUDE_SETTING]: { "**/node_modules": true } });
        expect(searchExcludeGlobs(onlySearch)).toEqual(["**/node_modules"]);
        const onlyFiles = reader({ [FILES_EXCLUDE_SETTING]: { "**/.git": true } });
        expect(searchExcludeGlobs(onlyFiles)).toEqual(["**/.git"]);
    });
});

describe("isExcludedPath", () => {
    it("`**/<имя>` матчит вход и в корне, и на глубине", () => {
        expect(isExcludedPath("__pycache__", ["**/__pycache__"])).toBe(true);
        expect(isExcludedPath("pkg/sub/__pycache__", ["**/__pycache__"])).toBe(true);
    });

    it("шаблон без `**/` якорится в корне", () => {
        expect(isExcludedPath("out", ["out"])).toBe(true);
        expect(isExcludedPath("pkg/out", ["out"])).toBe(false);
    });

    it("сам корень не исключается никогда", () => {
        expect(isExcludedPath("", ["**/anything", "**"])).toBe(false);
    });

    it("пустой набор не исключает ничего", () => {
        expect(isExcludedPath("node_modules", [])).toBe(false);
    });

    it("похожее имя не задевается", () => {
        expect(isExcludedPath("outline.ts", ["**/out"])).toBe(false);
        expect(isExcludedPath("node_modules_backup", ["**/node_modules"])).toBe(false);
    });
});

// Дефолты обеих настроек — на живых путях. Таблицы перечисляют пути ЯВНО (а не
// выводятся из шаблонов): иначе тест переписывался бы вместе с опечаткой в
// дефолте и ничего не проверял.
describe("дефолты files.exclude / search.exclude", () => {
    /** Собирает значение так же, как ConfigurationService: defaults + user. */
    function merged(userValue: Readonly<Record<string, unknown>> = {}): IExcludeConfigReader {
        const defaults = ConfigurationModel.fromRaw(
            new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getDefaultConfiguration(),
        );
        const user = ConfigurationModel.fromRaw(userValue);
        const model = ConfigurationModel.merge(defaults, user);
        return { get: (key: string): unknown => model.get(key) };
    }

    const hiddenEverywhere = [
        // Набор эталона.
        ".git",
        "sub/.git",
        ".svn",
        ".hg",
        ".DS_Store",
        "src/.DS_Store",
        "Thumbs.db",
        // Наша добавка — кеши, чьё содержимое не читают.
        "__pycache__",
        "pkg/sub/__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
    ];

    const hiddenInSearchOnly = [
        // Набор эталона.
        "node_modules",
        "packages/app/node_modules",
        "bower_components",
        // Зависимости Python, результат сборки, кеши сборщиков.
        ".venv",
        "dist",
        "out",
        "build",
        "target",
        "coverage",
        ".next",
        ".gradle",
        ".cache",
        ".turbo",
        // Полные копии репозитория.
        ".stryker-tmp",
        ".claude/worktrees",
    ];

    const visibleAndSearchable = [
        "src",
        "src/main.ts",
        ".gitignore",
        "docs/build.md",
        "distribution",
        "outline.ts",
        "node_modules_backup",
        // `.claude` исключён не весь: настройки и скиллы как раз ищут.
        ".claude",
        ".claude/settings.json",
    ];

    it.each(hiddenEverywhere)("скрыт и в дереве, и в поиске: %s", (relative) => {
        const config = merged();
        expect(isExcludedPath(relative, filesExcludeGlobs(config))).toBe(true);
        expect(isExcludedPath(relative, searchExcludeGlobs(config))).toBe(true);
    });

    it.each(hiddenInSearchOnly)("в дереве виден, в поиске нет: %s", (relative) => {
        const config = merged();
        expect(isExcludedPath(relative, filesExcludeGlobs(config))).toBe(false);
        expect(isExcludedPath(relative, searchExcludeGlobs(config))).toBe(true);
    });

    it.each(visibleAndSearchable)("виден и ищется: %s", (relative) => {
        const config = merged();
        expect(isExcludedPath(relative, searchExcludeGlobs(config))).toBe(false);
    });

    it("node_modules в дереве ВИДЕН — осознанное выравнивание на эталон", () => {
        // До этого узла дерево скрывало его захардкоженным списком. У эталона
        // `files.exclude` его не содержит: исходник зависимости читают, а шумит
        // он в результатах поиска — поэтому он в `search.exclude`.
        const config = merged();
        expect(filesExcludeGlobs(config)).not.toContain("**/node_modules");
        expect(parseExcludeSetting(config.get(SEARCH_EXCLUDE_SETTING))).toContain("**/node_modules");
    });

    it("свой шаблон добавляется к дефолтным, а не заменяет их", () => {
        const config = merged({ [FILES_EXCLUDE_SETTING]: { "**/vendor": true } });
        const globs = filesExcludeGlobs(config);
        expect(globs).toContain("**/vendor");
        expect(globs).toContain("**/.git");
    });

    it("ненужный дефолт гасится значением false", () => {
        const config = merged({ [FILES_EXCLUDE_SETTING]: { "**/__pycache__": false } });
        const globs = filesExcludeGlobs(config);
        expect(globs).not.toContain("**/__pycache__");
        expect(globs).toContain("**/.git");
        expect(isExcludedPath("pkg/__pycache__", globs)).toBe(false);
    });

    it("погашенный дефолт `files.exclude` не возвращается через поиск", () => {
        // Иначе `false` в одной настройке молча перебивался бы второй.
        const config = merged({ [FILES_EXCLUDE_SETTING]: { "**/.git": false } });
        expect(isExcludedPath(".git", searchExcludeGlobs(config))).toBe(false);
    });

    it("все дефолтные шаблоны включены: карта `{ glob: true }`, как в эталоне", () => {
        for (const key of [FILES_EXCLUDE_SETTING, SEARCH_EXCLUDE_SETTING]) {
            const value = merged().get(key) as Record<string, unknown>;
            expect(
                Object.values(value).every((enabled) => enabled === true),
                key,
            ).toBe(true);
        }
    });

    it("каждый дефолт — в форме `**/<имя>`: скрывается САМ вход", () => {
        // Форма `**/<имя>/**` каталог не матчит: он остался бы в дереве пустым,
        // а обход всё равно спускался бы внутрь. Ровно та же причина, по которой
        // переякорены дефолты `files.watcherExclude`.
        const config = merged();
        for (const glob of [...filesExcludeGlobs(config), ...parseExcludeSetting(config.get(SEARCH_EXCLUDE_SETTING))]) {
            expect(glob.startsWith("**/"), glob).toBe(true);
            expect(glob.endsWith("/**"), glob).toBe(false);
        }
    });
});

describe("readUseIgnoreFiles", () => {
    it("без значений — дефолты эталона: свои ignore-файлы да, родительские и глобальный нет", () => {
        expect(readUseIgnoreFiles(reader({}))).toEqual({ local: true, parent: false, global: false });
    });

    it("зарегистрированные дефолты дают то же самое", () => {
        const defaults = ConfigurationModel.fromRaw(
            new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getDefaultConfiguration(),
        );
        expect(readUseIgnoreFiles({ get: (key) => defaults.get(key) })).toEqual({
            local: true,
            parent: false,
            global: false,
        });
    });

    it("читает все три ключа", () => {
        expect(
            readUseIgnoreFiles(
                reader({
                    [SEARCH_USE_IGNORE_FILES_SETTING]: false,
                    [SEARCH_USE_PARENT_IGNORE_FILES_SETTING]: true,
                    [SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING]: true,
                }),
            ),
        ).toEqual({ local: false, parent: true, global: true });
    });

    it("битое значение — дефолт, а не включение и не выключение", () => {
        expect(
            readUseIgnoreFiles(
                reader({
                    [SEARCH_USE_IGNORE_FILES_SETTING]: "no",
                    [SEARCH_USE_PARENT_IGNORE_FILES_SETTING]: "yes",
                    [SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING]: 1,
                }),
            ),
        ).toEqual({ local: true, parent: false, global: false });
    });
});
