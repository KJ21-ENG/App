import type {ValueOf} from 'type-fest';
import type CONST from '@src/CONST';

/** The columns the Workspaces list page can sort by */
type WorkspacesListSortBy = 'name' | 'owner';

/** Persisted sort preference for the Workspaces list page */
type WorkspacesListSort = {
    /** The column the user is sorting by */
    sortBy: WorkspacesListSortBy;

    /** The direction (asc/desc) of the sort */
    sortOrder: ValueOf<typeof CONST.SEARCH.SORT_ORDER>;
};

export default WorkspacesListSort;
export type {WorkspacesListSortBy};
