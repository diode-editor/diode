/**
 * Id контейнера Source Control и его view-секций. Живут в `common/`, а не рядом
 * со своими компонентами: на них ссылаются и сами компоненты, и экшены, и
 * `ScmInputComponent` — а тот собирается `ChangesComponent`'ом, так что
 * объявление в `changesComponent.ts` замкнуло бы импорты в цикл.
 */

/** Id вьюлета Source Control в сайдбаре (см. `SidebarService`). */
export const SCM_VIEWLET_ID = "scm";

/** Id view-секции CHANGES внутри контейнера Source Control (см. `ViewsService`). */
export const SCM_CHANGES_VIEW_ID = "workbench.scm.changes";

/** Id view-секции GRAPH внутри контейнера Source Control (см. `ViewsService`). */
export const SCM_GRAPH_VIEW_ID = "workbench.scm.graph";
