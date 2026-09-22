# Что обязано быть в PR

## Демо-сценарий для видимых фич

Любая фича с видимой/внешней составляющей (новый виджет, оверлей, изменение layout, темизации, статус-бара,
дерева файлов и т.п.) обязана принести **сценарий-демо**:

1. Добавь или обнови сценарий в `e2e/scenarios/` (`*.scenario.ts`) — код, который поднимает настоящий
   редактор headless, шлёт нужные команды и снимает кадр(ы). Формат — `defineScenario({ name, open, run })`;
   за образец возьми `e2e/scenarios/quickOpen.scenario.ts`.
2. Прогони `npm run screenshots` — сгенерит PNG в `screenshots/` (каталог в `.gitignore`) +
   `screenshots/INDEX.md`. Посмотри на кадры **сам**: в #194 пропущенный сценарий стоил бага, который
   виден на первом же кадре.
3. В теле PR опиши, что на этих кадрах происходит, и как то же самое пройти руками.

Сценарий — это гейт, а не украшение: он остаётся в репозитории и ловит регрессии дальше.

## Ссылка на сборку

Прикладывать PNG к телу PR больше не требуется. Работу принимают на **собранном бинарнике**: на каждый PR
в `main` workflow `PR Build` собирает SEA-бинарники под все платформы и сам публикует в PR комментарий
со ссылкой на артефакты прогона. Если PR собирает офис агентов (итерация), ссылка на прогон ещё и дублируется
в теле PR — см. [office/README.md](../office/README.md).

Убедись, что сборка зелёная, прежде чем звать человека принимать: красный `PR Build` — это «не готово»,
даже если тесты локально зелёные.

## Если картинку всё-таки хочется приложить

GitHub показывает изображения в теле PR только по URL, а из CLI нельзя залить их в user-content CDN
(это только drag-drop в вебе). Поэтому PNG кладут в **эфемерную orphan-ветку** `pr-assets/<имя-ветки>`
(без общей истории — только блобы картинок) и ссылаются по commit-SHA. Пламбинг ниже **не трогает рабочее
дерево**:

```bash
# из корня репо, после `npm run screenshots`; репо должен быть публичным (иначе camo не отрендерит raw)
E=$(git hash-object -w screenshots/<shot1>.png)
R=$(printf 'Ephemeral screenshot assets for the <branch> PR. Safe to delete after merge.\n' | git hash-object -w --stdin)
T=$(printf '100644 blob %s\t<shot1>.png\n100644 blob %s\tREADME.md\n' "$E" "$R" | git mktree)
C=$(git commit-tree "$T" -m "chore: ephemeral screenshot assets for <branch> PR")   # orphan: без -p
git push origin "$C:refs/heads/pr-assets/<branch>"
# в теле PR ссылайся по SHA (однозначно, без проблем со слэшем в имени ветки):
#   ![editor](https://raw.githubusercontent.com/<owner>/<repo>/$C/<shot1>.png)
```

После мерджа/закрытия PR ветку чистим: `git push origin --delete pr-assets/<branch>`.

Подробности про сценарии и как это гоняется в CI — [TESTING.md](TESTING.md) (раздел «E2E → Скриншот-демо»).
