// В `common/`, а не рядом с компонентами: объявление в `changesComponent.ts`
// замкнуло бы импорты в цикл через `ScmInputComponent`.

export const SCM_VIEWLET_ID = "scm";

export const SCM_CHANGES_VIEW_ID = "workbench.scm.changes";

export const SCM_GRAPH_VIEW_ID = "workbench.scm.graph";
