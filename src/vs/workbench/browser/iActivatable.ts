/** Components are assembled in the constructor; async initialization (disk, indexing, spawn) is for services only. */
export interface IActivatable {
    activate(): Promise<void>;
}
