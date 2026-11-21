import {act, render} from '@testing-library/react-native';

import ComposeProviders from '@components/ComposeProviders';
import DestinationPicker from '@components/DestinationPicker';
import {LocaleContextProvider} from '@components/LocaleContextProvider';
import OnyxListItemProvider from '@components/OnyxListItemProvider';
import type {Section, SelectionListWithSectionsProps} from '@components/SelectionList/SelectionListWithSections/types';
import type {ListItem} from '@components/SelectionList/types';

import CONST from '@src/CONST';
import IntlStore from '@src/languages/IntlStore';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Rate} from '@src/types/onyx/Policy';

import React from 'react';
import Onyx from 'react-native-onyx';

import createRandomPolicy from '../utils/collections/policies';
import {translateLocal} from '../utils/TestHelper';
import waitForBatchedUpdatesWithAct from '../utils/waitForBatchedUpdatesWithAct';

// Counts the sorts of destinations by name, to check that the picker does not sort them again on every search
let mockDestinationSortCount = 0;
jest.mock('lodash/sortBy', () => {
    const actualSortBy = jest.requireActual<(...args: unknown[]) => unknown[]>('lodash/sortBy');
    return (...args: unknown[]) => {
        if (args.at(1) === 'name') {
            mockDestinationSortCount++;
        }
        return actualSortBy(...args);
    };
});

const mockSelectionList = jest.fn<null, [SelectionListWithSectionsProps<ListItem>]>(() => null);
jest.mock('@components/SelectionList/SelectionListWithSections', () => ({
    __esModule: true,
    default: (props: SelectionListWithSectionsProps<ListItem>) => mockSelectionList(props),
}));

const POLICY_ID = 'destination-picker-policy';
const CUSTOM_UNIT_ID = 'destination-picker-unit';

// Per diem rates as a workspace stores them, keyed by rate ID: [rate ID, name, currency].
const destinationRows: Array<[string, string | undefined, string | undefined]> = [
    ['germany-bonn', 'germany - bonn', 'EUR'],
    ['zone-9', 'Zone 9', undefined],
    ['zurich-accent', 'Zürich', 'CHF'],
    ['paris-b', 'France - Paris', 'EUR'],
    ['unnamed', undefined, 'EUR'],
    ['zone-10', 'Zone 10', undefined],
    ['zurich', 'Zurich', 'CHF'],
    ['paris-a', 'France - Paris', 'EUR'],
    ['empty', '', 'EUR'],
    ['berlin', 'Germany - Berlin', 'EUR'],
    ['bogota', 'Colombia - Bogotá', 'COP'],
    ['curacao', 'Curaçao', 'ANG'],
    ['cuba', 'Cuba - Havana', undefined],
];

// The picker's order: names compared by character code, equal names in the stored order, a rate without a name last.
const sortedRateIDs = ['empty', 'bogota', 'cuba', 'curacao', 'paris-b', 'paris-a', 'berlin', 'zone-10', 'zone-9', 'zurich', 'zurich-accent', 'germany-bonn', 'unnamed'];

function createRates(rows: Array<[string, string | undefined, string | undefined]>): Record<string, Rate> {
    return Object.fromEntries(rows.map(([rateID, name, currency]) => [rateID, {customUnitRateID: rateID, name, currency, enabled: true, rate: 100}]));
}

async function setRates(rates: Record<string, Rate>) {
    await act(async () => {
        await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${POLICY_ID}`, {
            ...createRandomPolicy(1),
            id: POLICY_ID,
            customUnits: {[CUSTOM_UNIT_ID]: {customUnitID: CUSTOM_UNIT_ID, name: CONST.CUSTOM_UNITS.NAME_PER_DIEM_INTERNATIONAL, rates}},
        });
    });
    await waitForBatchedUpdatesWithAct();
}

/** Merges rate changes into the stored rates, as an update from the server does. A null rate removes that rate. */
async function mergeRates(changes: Array<[string, Partial<Rate> | null]>) {
    await act(async () => {
        await Onyx.merge(`${ONYXKEYS.COLLECTION.POLICY}${POLICY_ID}`, {
            customUnits: {[CUSTOM_UNIT_ID]: {rates: Object.fromEntries(changes)}},
        });
    });
    await waitForBatchedUpdatesWithAct();
}

async function setRecentlyUsedDestinations(rateIDs: string[]) {
    await act(async () => {
        await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY_RECENTLY_USED_DESTINATIONS}${POLICY_ID}`, rateIDs);
    });
    await waitForBatchedUpdatesWithAct();
}

function renderPicker(selectedDestination?: string) {
    const renderWithSelection = (selected?: string) => (
        <ComposeProviders components={[OnyxListItemProvider, LocaleContextProvider]}>
            <DestinationPicker
                policyID={POLICY_ID}
                selectedDestination={selected}
                onSubmit={() => {}}
            />
        </ComposeProviders>
    );
    const view = render(renderWithSelection(selectedDestination));
    return {...view, rerenderWithSelection: (selected?: string) => view.rerender(renderWithSelection(selected))};
}

function getLastListProps() {
    const listProps = mockSelectionList.mock.lastCall?.[0];
    if (!listProps) {
        throw new Error('DestinationPicker did not render the list');
    }
    return listProps;
}

/** Each section's title and index, the rate IDs it lists in order, and which of them are marked selected */
function summarize(sections: Array<Section<ListItem>>) {
    return sections.map((section) => ({
        title: section.title,
        sectionIndex: section.sectionIndex,
        rateIDs: section.data.map((option) => option.keyForList),
        selectedRateIDs: section.data.filter((option) => option.isSelected).map((option) => option.keyForList),
    }));
}

/** Types into the picker's search box and waits for the debounced search text the picker filters with */
async function typeSearch(searchValue: string) {
    await act(async () => {
        getLastListProps().textInputOptions?.onChangeText?.(searchValue);
    });
    await act(async () => {
        jest.advanceTimersByTime(CONST.TIMING.USE_DEBOUNCED_STATE_DELAY);
    });
}

describe('DestinationPicker', () => {
    beforeAll(async () => {
        Onyx.init({keys: ONYXKEYS});
        await IntlStore.load(CONST.LOCALES.EN);
    });

    beforeEach(async () => {
        jest.useFakeTimers({doNotFake: ['nextTick', 'setImmediate']});
        mockSelectionList.mockClear();
        await act(async () => {
            await Onyx.clear();
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('lists the selected, recently used and all destinations in name order, with a search box', async () => {
        // Given a workspace with more destinations than the search box limit, some of them used recently
        await setRates(createRates(destinationRows));
        await setRecentlyUsedDestinations(['zurich', 'unnamed', 'berlin', 'cuba']);

        // When the picker opens with a destination already selected
        renderPicker('zone-9');
        await waitForBatchedUpdatesWithAct();

        // Then it lists the selected destination, the recent ones in name order, and every destination in name order
        const listProps = getLastListProps();
        expect(summarize(listProps.sections)).toStrictEqual([
            {title: '', sectionIndex: 1, rateIDs: ['zone-9'], selectedRateIDs: ['zone-9']},
            {title: translateLocal('common.recent'), sectionIndex: 3, rateIDs: ['cuba', 'berlin', 'zurich', 'unnamed'], selectedRateIDs: []},
            {title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []},
        ]);
        expect(listProps.shouldShowTextInput).toBe(true);
        expect(listProps.initiallyFocusedItemKey).toBe('zone-9');
        expect(listProps.textInputOptions?.value).toBe('');
        expect(listProps.textInputOptions?.headerMessage).toBe('');
    });

    it('lists the destinations that match the search, then every destination again when the search is cleared', async () => {
        // Given an open picker with a selected destination
        await setRates(createRates(destinationRows));
        renderPicker('paris-a');
        await waitForBatchedUpdatesWithAct();
        const sectionsBeforeSearch = getLastListProps().sections;
        expect(summarize(sectionsBeforeSearch)).toStrictEqual([
            {title: '', sectionIndex: 1, rateIDs: ['paris-a'], selectedRateIDs: ['paris-a']},
            {title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []},
        ]);

        // When the user searches, the list shows only the matches, in name order, with the selected one marked
        await typeSearch('fr par');
        expect(getLastListProps().textInputOptions?.value).toBe('fr par');
        expect(summarize(getLastListProps().sections)).toStrictEqual([{title: '', sectionIndex: 0, rateIDs: ['paris-b', 'paris-a'], selectedRateIDs: ['paris-a']}]);
        expect(getLastListProps().initiallyFocusedItemKey).toBe('paris-a');

        await typeSearch('GERMANY');
        expect(summarize(getLastListProps().sections)).toStrictEqual([{title: '', sectionIndex: 0, rateIDs: ['berlin', 'germany-bonn'], selectedRateIDs: []}]);
        expect(getLastListProps().initiallyFocusedItemKey).toBeUndefined();

        // When the search is cleared, the list is the same as before the search
        await typeSearch('');
        expect(getLastListProps().sections).toStrictEqual(sectionsBeforeSearch);
        expect(getLastListProps().initiallyFocusedItemKey).toBe('paris-a');
    });

    it('shows the no results message when no destination matches the search', async () => {
        await setRates(createRates(destinationRows));
        renderPicker();
        await waitForBatchedUpdatesWithAct();

        await typeSearch('xyz');

        expect(summarize(getLastListProps().sections)).toStrictEqual([{title: '', sectionIndex: 0, rateIDs: [], selectedRateIDs: []}]);
        expect(getLastListProps().textInputOptions?.headerMessage).toBe(translateLocal('common.noResultsFound'));
    });

    it('hides the search box and lists each destination once when there are fewer than the search box limit', async () => {
        // Given a workspace with three destinations, some used recently
        await setRates(createRates(destinationRows.slice(0, 3)));
        await setRecentlyUsedDestinations(['zurich-accent']);

        // When the picker opens with one of them selected
        renderPicker('zone-9');
        await waitForBatchedUpdatesWithAct();

        // Then it lists the selected one first and the others once, without a recent section or a search box
        expect(summarize(getLastListProps().sections)).toStrictEqual([
            {title: '', sectionIndex: 1, rateIDs: ['zone-9'], selectedRateIDs: ['zone-9']},
            {title: '', sectionIndex: 2, rateIDs: ['zurich-accent', 'germany-bonn'], selectedRateIDs: []},
        ]);
        expect(getLastListProps().shouldShowTextInput).toBe(false);
    });

    it('shows destinations that are renamed, added or removed while the picker is open', async () => {
        // Given an open picker
        await setRates(createRates(destinationRows));
        renderPicker();
        await waitForBatchedUpdatesWithAct();
        expect(summarize(getLastListProps().sections)).toStrictEqual([{title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []}]);

        // When one destination is renamed and another one is added
        await mergeRates([
            ['zone-9', {name: 'Austria - Vienna'}],
            ['oslo', {customUnitRateID: 'oslo', name: 'Norway - Oslo', currency: 'NOK', enabled: true, rate: 100}],
        ]);

        // Then the list shows them in their new places, and the search finds them
        expect(summarize(getLastListProps().sections)).toStrictEqual([
            {
                title: translateLocal('common.all'),
                sectionIndex: 4,
                rateIDs: ['empty', 'zone-9', 'bogota', 'cuba', 'curacao', 'paris-b', 'paris-a', 'berlin', 'oslo', 'zone-10', 'zurich', 'zurich-accent', 'germany-bonn', 'unnamed'],
                selectedRateIDs: [],
            },
        ]);
        await typeSearch('vienna');
        expect(summarize(getLastListProps().sections)).toStrictEqual([{title: '', sectionIndex: 0, rateIDs: ['zone-9'], selectedRateIDs: []}]);
        await typeSearch('oslo');
        expect(summarize(getLastListProps().sections)).toStrictEqual([{title: '', sectionIndex: 0, rateIDs: ['oslo'], selectedRateIDs: []}]);

        // When a destination is removed during a search, the search no longer finds it
        await typeSearch('germany');
        await mergeRates([['berlin', null]]);
        expect(summarize(getLastListProps().sections)).toStrictEqual([{title: '', sectionIndex: 0, rateIDs: ['germany-bonn'], selectedRateIDs: []}]);
    });

    it('sorts the destinations once while the user searches, and again only when the rates change', async () => {
        // Given an open picker with a selected destination and recently used ones
        await setRates(createRates(destinationRows));
        await setRecentlyUsedDestinations(['zurich', 'cuba']);
        mockDestinationSortCount = 0;
        renderPicker('zone-9');
        await waitForBatchedUpdatesWithAct();
        expect(mockDestinationSortCount).toBe(1);

        // When the user types, changes the search and clears it
        await typeSearch('g');
        await typeSearch('ger');
        await typeSearch('germany b');
        await typeSearch('');

        // Then the destinations are not sorted again
        expect(summarize(getLastListProps().sections).map((section) => section.rateIDs.length)).toStrictEqual([1, 2, sortedRateIDs.length]);
        expect(mockDestinationSortCount).toBe(1);

        // When a destination is renamed, they are sorted once more, and a search after that does not sort them again
        await mergeRates([['zone-9', {name: 'Austria - Vienna'}]]);
        await typeSearch('austria');
        expect(summarize(getLastListProps().sections)).toStrictEqual([{title: '', sectionIndex: 0, rateIDs: ['zone-9'], selectedRateIDs: ['zone-9']}]);
        expect(mockDestinationSortCount).toBe(2);
    });

    it('follows changes to the recently used destinations and to the selected destination', async () => {
        // Given an open picker with one recently used destination
        await setRates(createRates(destinationRows));
        await setRecentlyUsedDestinations(['cuba']);
        const {rerenderWithSelection} = renderPicker();
        await waitForBatchedUpdatesWithAct();
        expect(summarize(getLastListProps().sections)).toStrictEqual([
            {title: translateLocal('common.recent'), sectionIndex: 3, rateIDs: ['cuba'], selectedRateIDs: []},
            {title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []},
        ]);

        // When another destination is used
        await setRecentlyUsedDestinations(['zurich', 'cuba']);
        expect(summarize(getLastListProps().sections)).toStrictEqual([
            {title: translateLocal('common.recent'), sectionIndex: 3, rateIDs: ['cuba', 'zurich'], selectedRateIDs: []},
            {title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []},
        ]);

        // When a destination is selected
        rerenderWithSelection('cuba');
        await waitForBatchedUpdatesWithAct();
        expect(summarize(getLastListProps().sections)).toStrictEqual([
            {title: '', sectionIndex: 1, rateIDs: ['cuba'], selectedRateIDs: ['cuba']},
            {title: translateLocal('common.recent'), sectionIndex: 3, rateIDs: ['zurich'], selectedRateIDs: []},
            {title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []},
        ]);
        expect(getLastListProps().initiallyFocusedItemKey).toBe('cuba');
    });
});
