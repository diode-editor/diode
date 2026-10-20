# Source Control — follow-up'ы

Статус: `[~]` — вьюлет Source Control (staging, commit, sync/branch/stash/remote, меню «⋯»,
статус-бар, прогресс операций) и секция GRAPH сделаны; устройство —
[arch/workbench/SourceControl.md](../arch/workbench/SourceControl.md). Ниже — только открытое.

## Вьюлет

- [ ] **`diode.scm.publishBusy`** — занятость расширения наружу не публикуется: фоновый refresh по
  watcher'у и чужая операция в очереди мутаций спиннера не дают (есть только прогресс операций,
  запущенных из ядра).
- [ ] **UI-e2e с bare-remote для sync/branch/stash** — сейчас эти потоки покрыты юнитами
  (`syncActions`/`branchActions`/`stashActions`/… `.test.ts`) и интеграцией расширения.

## GRAPH

- [ ] Пикер ref'ов и режим `all` (в VS Code — `scm.graphView.referencesFilter`); сейчас жёстко
  `auto` = HEAD + upstream.
- [ ] Активация коммита: показ его файлов и диффа (нужен multi-diff), Compare with Remote / Merge Base /
  произвольным ref'ом.
- [ ] Действия на бейджах (Checkout ▸ / Delete Branch ▸ / Delete Tag ▸ — динамические подменю по ref'ам
  коммита, приём VS Code).
- [ ] Автоподгрузка по скроллу (`scm.graph.pageOnScroll`), incoming/outgoing псевдо-коммиты.
- [ ] Цвет `scmGraph.historyItemBaseRefColor` зарегистрирован, но не используется — появится вместе с
  Compare with Merge Base.
