/**
 * Measures opening the per diem Destination picker and typing in its search box, for workspaces with many per diem
 * destinations. Each scenario renders the real DestinationPicker with N destinations in Onyx, one of them selected and
 * three used recently. The list itself is mocked, so the time is DestinationPicker's own work (its renders and
 * building the sections), not the list's rendering.
 *
 * - "open": renders the picker until it has handed the list its sections. Before each run one destination is renamed,
 *   so the picker gets a new rates object, as it does after any change to the rates.
 * - "reopen": the same, without changing the rates since the last run.
 * - "key": one key typed in the search box, through both renders it causes: one for the typed text, and one when the
 *   debounced search text that the list is filtered by catches up.
 *
 * The destinations are stored in a fixed random order, as rate IDs do not follow the destination names.
 *
 * Run with: npm run perf-local -- --testMatch '<rootDir>/tests/perf-local/DestinationPicker.perf-local.ts'
 * It prints one line per scenario, so it also runs under plain Jest:
 * npx jest --testMatch '<rootDir>/tests/perf-local/DestinationPicker.perf-local.ts' --runInBand
 */
import {act, render} from '@testing-library/react-native';

import ComposeProviders from '@components/ComposeProviders';
import DestinationPicker from '@components/DestinationPicker';
import {LocaleContextProvider} from '@components/LocaleContextProvider';
import OnyxListItemProvider from '@components/OnyxListItemProvider';
import type {SelectionListWithSectionsProps} from '@components/SelectionList/SelectionListWithSections/types';
import type {ListItem} from '@components/SelectionList/types';

import CONST from '@src/CONST';
import IntlStore from '@src/languages/IntlStore';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Rate} from '@src/types/onyx/Policy';

import React from 'react';
import Onyx from 'react-native-onyx';
import {measureAsyncFunction, measureFunction} from 'reassure';

import createRandomPolicy from '../utils/collections/policies';
import createMock from '../utils/createMock';
import waitForBatchedUpdatesWithAct from '../utils/waitForBatchedUpdatesWithAct';

const POLICY_ID = 'destination-picker-perf-policy';
const CUSTOM_UNIT_ID = 'destination-picker-perf-unit';
const RUNS = 10;
const WARMUP_RUNS = 1;
const TEST_TIMEOUT_MS = 20 * 60 * 1000;

const mockSelectionList = jest.fn<null, [SelectionListWithSectionsProps<ListItem>]>(() => null);
jest.mock('@components/SelectionList/SelectionListWithSections', () => ({
    __esModule: true,
    default: (props: SelectionListWithSectionsProps<ListItem>) => mockSelectionList(props),
}));

const COUNTRIES = [
    'Austria',
    'Belgium',
    'Brazil',
    'Canada',
    'Chile',
    'China',
    'Colombia',
    'Denmark',
    'Egypt',
    'Finland',
    'France',
    'Germany',
    'Ghana',
    'Greece',
    'Hungary',
    'India',
    'Ireland',
    'Italy',
    'Japan',
    'Kenya',
    'Mexico',
    'Norway',
    'Peru',
    'Poland',
    'Portugal',
    'Romania',
    'Spain',
    'Sweden',
    'Turkey',
    'Vietnam',
];
const PLACES = [
    'Accra',
    'Ankara',
    'Antwerp',
    'Athens',
    'Barcelona',
    'Beijing',
    'Bergen',
    'Berlin',
    'Bogotá',
    'Brussels',
    'Bucharest',
    'Budapest',
    'Cairo',
    'Copenhagen',
    'Cork',
    'Delhi',
    'Dublin',
    'Hamburg',
    'Hanoi',
    'Helsinki',
    'Istanbul',
    'Kyoto',
    'Lima',
    'Lisbon',
    'Lyon',
    'Madrid',
    'Milan',
    'Mumbai',
    'Nairobi',
    'Oslo',
    'Paris',
    'Porto',
    'Quebec',
    'Rome',
    'Santiago',
    'Shanghai',
    'Stockholm',
    'Toronto',
    'Vienna',
    'Warsaw',
];
const AREAS = [
    'Airport',
    'Central',
    'Coast',
    'County',
    'District',
    'Downtown',
    'East',
    'Harbor',
    'Highlands',
    'Islands',
    'Lower',
    'Metro',
    'North',
    'Province',
    'Region',
    'Rural',
    'South',
    'Upper',
    'Valley',
    'West',
];

/** A small seeded random number generator (Park-Miller), so every run uses the same destinations. */
function createRandom(seed: number) {
    let state = seed;
    return () => {
        state = (state * 48271) % 2147483647;
        return (state - 1) / 2147483646;
    };
}

/** Unique destination names such as "Germany - Berlin Airport 12", in the random order they were made */
function createDestinationNames(count: number): string[] {
    const random = createRandom(count);
    const pick = (values: string[]) => values.at(Math.floor(random() * values.length)) ?? '';
    const names = new Set<string>();
    while (names.size < count) {
        names.add(`${pick(COUNTRIES)} - ${pick(PLACES)} ${pick(AREAS)} ${1 + Math.floor(random() * 99)}`);
    }
    return [...names];
}

function getRateID(index: number) {
    return `rate-${index}`;
}

function createRates(names: string[]): Record<string, Rate> {
    return Object.fromEntries(names.map((name, index) => [getRateID(index), {customUnitRateID: getRateID(index), name, currency: 'EUR', enabled: true, rate: 100}]));
}

function getLastListProps() {
    const listProps = mockSelectionList.mock.lastCall?.[0];
    if (!listProps) {
        throw new Error('DestinationPicker did not render the list');
    }
    return listProps;
}

function getListedRowCount(listProps: SelectionListWithSectionsProps<ListItem>) {
    return listProps.sections.reduce((total, section) => total + section.data.length, 0);
}

/** A short hash of every section's title and listed rows, so the output of two builds can be compared in the log */
function getSectionsFingerprint(listProps: SelectionListWithSectionsProps<ListItem>) {
    const text = listProps.sections
        .map((section) => `${section.title ?? ''}|${section.sectionIndex}|${section.data.map((option) => `${option.keyForList}:${option.text}:${option.isSelected ? 1 : 0}`).join(',')}`)
        .join(';');
    let hash = 7;
    for (let index = 0; index < text.length; index++) {
        hash = (hash * 31 + text.charCodeAt(index)) % 2147483647;
    }
    return hash.toString(16);
}

function writeResult(
    label: string,
    result: {meanDuration: number; stdevDuration: number; durations: number[]; outlierDurations?: number[]},
    listProps: SelectionListWithSectionsProps<ListItem>,
) {
    // Written to stdout directly so the numbers reach the CI log even when Jest runs with --silent.
    const durations = result.durations.map((duration) => duration.toFixed(1)).join(', ');
    const outliers = (result.outlierDurations ?? []).map((duration) => duration.toFixed(1)).join(', ');
    process.stdout.write(
        `[DestinationPickerBench] ${label} mean=${result.meanDuration.toFixed(1)}ms stdev=${result.stdevDuration.toFixed(1)}ms runs=${RUNS} durations=[${durations}] outliers=[${outliers}] listedRows=${getListedRowCount(listProps)} fingerprint=${getSectionsFingerprint(listProps)}\n`,
    );
}

function renderPicker(selectedDestination: string) {
    return render(
        React.createElement(
            ComposeProviders,
            createMock<React.ComponentProps<typeof ComposeProviders>>({components: [OnyxListItemProvider, LocaleContextProvider]}),
            React.createElement(DestinationPicker, {policyID: POLICY_ID, selectedDestination, onSubmit: () => {}}),
        ),
    );
}

/** Types into the search box and lets the debounced search text catch up, so the picker renders the filtered list */
function typeSearch(listProps: SelectionListWithSectionsProps<ListItem>, searchValue: string) {
    act(() => {
        listProps.textInputOptions?.onChangeText?.(searchValue);
    });
    act(() => {
        jest.advanceTimersByTime(CONST.TIMING.USE_DEBOUNCED_STATE_DELAY);
    });
}

const DESTINATION_COUNTS = [1_000, 5_000, 29_270];
const KEYSTROKES = [
    {searchBefore: '', searchAfter: 'b'},
    {searchBefore: 'be', searchAfter: 'ber'},
];
// Destination 0 is the selected one, these are the recently used ones
const RECENT_DESTINATION_INDEXES = [1, 2, 3];

describe('Destination picker', () => {
    beforeAll(async () => {
        Onyx.init({keys: ONYXKEYS});
        await IntlStore.load(CONST.LOCALES.EN);
    });

    beforeEach(async () => {
        jest.useFakeTimers({doNotFake: ['nextTick', 'setImmediate', 'performance']});
        mockSelectionList.mockClear();
        await act(async () => {
            await Onyx.clear();
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /** Stores N destinations, one selected and a few recently used, and returns what the picker should list */
    async function setUpDestinations(destinationCount: number) {
        const names = createDestinationNames(destinationCount);
        await act(async () => {
            await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${POLICY_ID}`, {
                ...createRandomPolicy(1),
                id: POLICY_ID,
                customUnits: {[CUSTOM_UNIT_ID]: {customUnitID: CUSTOM_UNIT_ID, name: CONST.CUSTOM_UNITS.NAME_PER_DIEM_INTERNATIONAL, rates: createRates(names)}},
            });
            await Onyx.set(
                `${ONYXKEYS.COLLECTION.POLICY_RECENTLY_USED_DESTINATIONS}${POLICY_ID}`,
                RECENT_DESTINATION_INDEXES.map((index) => getRateID(index)),
            );
        });
        await waitForBatchedUpdatesWithAct();
        // The selected destination, the recent ones and every destination
        return {names, selectedDestination: getRateID(0), openRowCount: 1 + RECENT_DESTINATION_INDEXES.length + destinationCount};
    }

    test.each(DESTINATION_COUNTS.flatMap((destinationCount) => [true, false].map((shouldChangeRates) => ({destinationCount, shouldChangeRates}))))(
        'opening with $destinationCount destinations (rates changed before each open: $shouldChangeRates)',
        async ({destinationCount, shouldChangeRates}) => {
            const {names, selectedDestination, openRowCount} = await setUpDestinations(destinationCount);
            let unmount = () => {};
            let completedOpens = 0;
            let runNumber = 0;

            const result = await measureAsyncFunction(
                async () => {
                    unmount = renderPicker(selectedDestination).unmount;
                    await waitForBatchedUpdatesWithAct();
                    if (getListedRowCount(getLastListProps()) === openRowCount) {
                        completedOpens++;
                    }
                },
                {
                    runs: RUNS,
                    warmupRuns: WARMUP_RUNS,
                    // The numbers are written to stdout below, so this also runs under plain Jest, which has no .reassure output folder
                    writeFile: false,
                    beforeEach: async () => {
                        mockSelectionList.mockClear();
                        if (!shouldChangeRates) {
                            return;
                        }
                        // Rename the last destination, so the stored rates are a new object, as after any change to the rates
                        runNumber++;
                        const lastIndex = destinationCount - 1;
                        await act(async () => {
                            await Onyx.merge(`${ONYXKEYS.COLLECTION.POLICY}${POLICY_ID}`, {
                                customUnits: {[CUSTOM_UNIT_ID]: {rates: Object.fromEntries([[getRateID(lastIndex), {name: `${names.at(lastIndex) ?? ''} ${runNumber}`}]])}},
                            });
                        });
                        await waitForBatchedUpdatesWithAct();
                    },
                    afterEach: async () => {
                        unmount();
                        await waitForBatchedUpdatesWithAct();
                    },
                },
            );

            // Open once more to record what the picker lists
            unmount = renderPicker(selectedDestination).unmount;
            await waitForBatchedUpdatesWithAct();
            writeResult(`destinations=${destinationCount} action=${shouldChangeRates ? 'open' : 'reopen'}`, result, getLastListProps());
            unmount();

            // Every measured run (plus the warmup run) listed the selected, recent and all destinations.
            expect(completedOpens).toBe(RUNS + WARMUP_RUNS);
        },
        TEST_TIMEOUT_MS,
    );

    test.each(DESTINATION_COUNTS.flatMap((destinationCount) => KEYSTROKES.map((keystroke) => ({destinationCount, ...keystroke}))))(
        '$destinationCount destinations, typing "$searchAfter" after "$searchBefore"',
        async ({destinationCount, searchBefore, searchAfter}) => {
            const {names, selectedDestination} = await setUpDestinations(destinationCount);
            const expectedMatches = names.filter((name) => name.toLowerCase().includes(searchAfter)).length;
            const {unmount} = renderPicker(selectedDestination);
            await waitForBatchedUpdatesWithAct();
            let listPropsBeforeKeystroke = getLastListProps();
            let completedKeystrokes = 0;

            const result = await measureFunction(
                () => {
                    typeSearch(listPropsBeforeKeystroke, searchAfter);
                    const listProps = getLastListProps();
                    if (listProps.textInputOptions?.value === searchAfter && listProps.sections.length === 1 && getListedRowCount(listProps) === expectedMatches) {
                        completedKeystrokes++;
                    }
                },
                {
                    runs: RUNS,
                    warmupRuns: WARMUP_RUNS,
                    writeFile: false,
                    // Put the search text back to its value before the keystroke, so every measured run makes the same keystroke.
                    beforeEach: async () => {
                        typeSearch(getLastListProps(), searchBefore);
                        await waitForBatchedUpdatesWithAct();
                        listPropsBeforeKeystroke = getLastListProps();
                        // Drop the recorded list props, so earlier runs' sections are not kept in memory.
                        mockSelectionList.mockClear();
                    },
                },
            );

            writeResult(`destinations=${destinationCount} action=key search="${searchBefore}"->"${searchAfter}"`, result, getLastListProps());
            unmount();

            // Every measured run (plus the warmup run) ended with the list filtered to the new search text.
            expect(completedKeystrokes).toBe(RUNS + WARMUP_RUNS);
        },
        TEST_TIMEOUT_MS,
    );
});
