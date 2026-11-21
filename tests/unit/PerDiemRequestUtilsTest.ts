import type {DestinationTreeSection} from '@libs/PerDiemRequestUtils';
import {getDestinationListSections, getTimeForDisplay} from '@libs/PerDiemRequestUtils';

import CONST from '@src/CONST';
import {getCustomUnitID} from '@src/libs/PerDiemRequestUtils';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Policy, Report, Transaction} from '@src/types/onyx';
import type {Rate} from '@src/types/onyx/Policy';

import {de} from 'date-fns/locale/de';
import Onyx from 'react-native-onyx';

import createRandomTransaction from '../utils/collections/transaction';
import {getFakePolicy, getFakeReport} from '../utils/LHNTestUtils';
import {translateLocal} from '../utils/TestHelper';

const policyID = '1';
const report: Report = {
    ...getFakeReport(),
    policyID,
    chatType: CONST.REPORT.CHAT_TYPE.POLICY_EXPENSE_CHAT,
};

const parentReport: Report = {
    ...getFakeReport(),
    policyID,
};

describe('PerDiemRequestUtils', () => {
    beforeAll(() =>
        Onyx.init({
            keys: ONYXKEYS,
        }),
    );

    beforeEach(() => {
        Onyx.clear();
    });

    it('getDestinationListSections()', () => {
        const tokenizeSearch = 'Antigua Barbuda';

        const destinations: Rate[] = [
            {
                currency: 'EUR',
                customUnitRateID: 'Afghanistan',
                enabled: true,
                name: 'Afghanistan',
                rate: 0,
            },
            {
                currency: 'EUR',
                customUnitRateID: 'Antigua and Barbuda',
                enabled: true,
                name: 'Antigua and Barbuda',
                rate: 0,
            },
        ];

        const searchResultList: DestinationTreeSection[] = [
            {
                data: [
                    {
                        currency: 'EUR',
                        isDisabled: false,
                        isSelected: false,
                        keyForList: 'Antigua and Barbuda',
                        searchText: 'Antigua and Barbuda',
                        text: 'Antigua and Barbuda',
                        tooltipText: 'Antigua and Barbuda',
                    },
                ],
                title: '',
                sectionIndex: 0,
            },
        ];

        const tokenizeSearchResult = getDestinationListSections({
            destinations,
            searchValue: tokenizeSearch,
            translate: translateLocal,
        });
        expect(tokenizeSearchResult).toStrictEqual(searchResultList);
    });

    describe('getDestinationListSections sections and order', () => {
        // Per diem rates as a workspace stores them, keyed by rate ID: [rate ID, name, currency]. The IDs are not
        // numbers, so the rates keep this order, which is the order equal names are listed in.
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

        // Names compare by character code: the empty name first, capitals before lower case, "10" before "9", plain
        // letters before accented ones, equal names in the stored order, and a rate without a name last.
        const sortedRateIDs = ['empty', 'bogota', 'cuba', 'curacao', 'paris-b', 'paris-a', 'berlin', 'zone-10', 'zone-9', 'zurich', 'zurich-accent', 'germany-bonn', 'unnamed'];

        function createRates(rows: Array<[string, string | undefined, string | undefined]>): Record<string, Rate> {
            return Object.fromEntries(rows.map(([rateID, name, currency]) => [rateID, {customUnitRateID: rateID, name, currency, enabled: true, rate: 100}]));
        }

        const allRates = createRates(destinationRows);

        /** Builds the sections the way DestinationPicker asks for them: from the rates, the search text and the selected rate ID */
        function getSections(
            rates: Record<string, Rate>,
            {searchValue = '', selectedRateID, recentlyUsedDestinations}: {searchValue?: string; selectedRateID?: string; recentlyUsedDestinations?: string[]} = {},
        ) {
            const selectedRate = selectedRateID ? rates[selectedRateID] : undefined;
            return getDestinationListSections({
                destinations: Object.values(rates),
                searchValue,
                selectedOptions: selectedRate
                    ? [{rateID: selectedRate.customUnitRateID, name: selectedRate.name ?? '', currency: selectedRate.currency ?? CONST.CURRENCY.USD, isSelected: true}]
                    : [],
                recentlyUsedDestinations,
                translate: translateLocal,
            });
        }

        /** Each section's title and index, the rate IDs it lists in order, and which of them are marked selected */
        function summarize(sections: DestinationTreeSection[]) {
            return sections.map((section) => ({
                title: section.title,
                sectionIndex: section.sectionIndex,
                rateIDs: section.data.map((option) => option.keyForList),
                selectedRateIDs: section.data.filter((option) => option.isSelected).map((option) => option.keyForList),
            }));
        }

        it('lists every destination by name, comparing character codes, with equal names in the stored order', () => {
            expect(summarize(getSections(allRates))).toStrictEqual([{title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []}]);
        });

        it('builds each row from the rate name, ID and currency', () => {
            const rates = createRates([
                ['unnamed', undefined, 'EUR'],
                ['cuba', 'Cuba - Havana', undefined],
                ['berlin', 'Germany - Berlin', 'EUR'],
            ]);

            expect(getSections(rates)).toStrictEqual([
                {
                    title: '',
                    sectionIndex: 2,
                    data: [
                        {
                            text: 'Cuba - Havana',
                            keyForList: 'cuba',
                            searchText: 'Cuba - Havana',
                            tooltipText: 'Cuba - Havana',
                            isDisabled: false,
                            isSelected: false,
                            currency: CONST.CURRENCY.USD,
                        },
                        {
                            text: 'Germany - Berlin',
                            keyForList: 'berlin',
                            searchText: 'Germany - Berlin',
                            tooltipText: 'Germany - Berlin',
                            isDisabled: false,
                            isSelected: false,
                            currency: 'EUR',
                        },
                        {text: '', keyForList: 'unnamed', searchText: '', tooltipText: '', isDisabled: false, isSelected: false, currency: 'EUR'},
                    ],
                },
            ]);
        });

        it('lists the selected destination first, and again without the selected mark in All', () => {
            expect(summarize(getSections(allRates, {selectedRateID: 'zone-9'}))).toStrictEqual([
                {title: '', sectionIndex: 1, rateIDs: ['zone-9'], selectedRateIDs: ['zone-9']},
                {title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []},
            ]);
        });

        it('lists up to five recently used destinations in name order, leaving out the selected one and unknown rate IDs', () => {
            const recentlyUsedDestinations = ['zurich', 'unnamed', 'berlin', 'not-a-rate', 'zone-9', 'cuba', 'curacao', 'empty'];

            expect(summarize(getSections(allRates, {selectedRateID: 'berlin', recentlyUsedDestinations}))).toStrictEqual([
                {title: '', sectionIndex: 1, rateIDs: ['berlin'], selectedRateIDs: ['berlin']},
                {title: translateLocal('common.recent'), sectionIndex: 3, rateIDs: ['empty', 'cuba', 'curacao', 'zone-9', 'zurich'], selectedRateIDs: []},
                {title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []},
            ]);
        });

        const searchCases: Array<[string, string[], string[]]> = [
            ['GERMANY', ['berlin', 'germany-bonn'], []],
            ['fr par', ['paris-b', 'paris-a'], ['paris-a']],
            [' paris ', ['paris-b', 'paris-a'], ['paris-a']],
            ['zone 1', ['zone-10'], []],
            ['ü', ['zurich-accent'], []],
            ['a b', ['bogota', 'cuba', 'berlin', 'germany-bonn'], []],
            ['xyz', [], []],
            ['  ', sortedRateIDs, ['paris-a']],
        ];

        it.each(searchCases)('lists the destinations that match every word of the search "%s" in name order, marking the selected one', (searchValue, rateIDs, selectedRateIDs) => {
            const sections = getSections(allRates, {searchValue, selectedRateID: 'paris-a', recentlyUsedDestinations: ['zurich', 'cuba']});

            expect(summarize(sections)).toStrictEqual([{title: '', sectionIndex: 0, rateIDs, selectedRateIDs}]);
        });

        it('lists fewer destinations than the search box limit in one section, without the selected one or a recent section', () => {
            const rates = createRates(destinationRows.slice(0, CONST.STANDARD_LIST_ITEM_LIMIT - 1));

            expect(summarize(getSections(rates, {selectedRateID: 'zone-9', recentlyUsedDestinations: ['zurich', 'zone-10']}))).toStrictEqual([
                {title: '', sectionIndex: 1, rateIDs: ['zone-9'], selectedRateIDs: ['zone-9']},
                {
                    title: '',
                    sectionIndex: 2,
                    rateIDs: ['empty', 'bogota', 'paris-b', 'paris-a', 'berlin', 'zone-10', 'zurich', 'zurich-accent', 'germany-bonn', 'unnamed'],
                    selectedRateIDs: [],
                },
            ]);
        });

        it('lists as many destinations as the search box limit with the recent and All sections', () => {
            const rates = createRates(destinationRows.slice(0, CONST.STANDARD_LIST_ITEM_LIMIT));

            expect(summarize(getSections(rates, {selectedRateID: 'zone-9', recentlyUsedDestinations: ['zurich', 'zone-10', 'curacao']}))).toStrictEqual([
                {title: '', sectionIndex: 1, rateIDs: ['zone-9'], selectedRateIDs: ['zone-9']},
                {title: translateLocal('common.recent'), sectionIndex: 3, rateIDs: ['curacao', 'zone-10', 'zurich'], selectedRateIDs: []},
                {
                    title: translateLocal('common.all'),
                    sectionIndex: 4,
                    rateIDs: ['empty', 'bogota', 'curacao', 'paris-b', 'paris-a', 'berlin', 'zone-10', 'zone-9', 'zurich', 'zurich-accent', 'germany-bonn', 'unnamed'],
                    selectedRateIDs: [],
                },
            ]);
        });

        it('lists only the selected destination when it is the only one, and nothing when there are no destinations', () => {
            const rates = createRates([['berlin', 'Germany - Berlin', 'EUR']]);

            expect(summarize(getSections(rates, {selectedRateID: 'berlin'}))).toStrictEqual([{title: '', sectionIndex: 1, rateIDs: ['berlin'], selectedRateIDs: ['berlin']}]);
            expect(getSections({})).toStrictEqual([]);
        });

        it('shows a renamed or added destination when the rates change, and the earlier list again for the earlier rates', () => {
            const changedRates = createRates([
                ...destinationRows.map(([rateID, name, currency]): [string, string | undefined, string | undefined] =>
                    rateID === 'zone-9' ? [rateID, 'Austria - Vienna', undefined] : [rateID, name, currency],
                ),
                ['oslo', 'Norway - Oslo', 'NOK'],
            ]);

            expect(summarize(getSections(allRates))).toStrictEqual([{title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []}]);
            expect(summarize(getSections(changedRates))).toStrictEqual([
                {
                    title: translateLocal('common.all'),
                    sectionIndex: 4,
                    rateIDs: ['empty', 'zone-9', 'bogota', 'cuba', 'curacao', 'paris-b', 'paris-a', 'berlin', 'oslo', 'zone-10', 'zurich', 'zurich-accent', 'germany-bonn', 'unnamed'],
                    selectedRateIDs: [],
                },
            ]);
            expect(summarize(getSections(changedRates, {searchValue: 'vienna'}))).toStrictEqual([{title: '', sectionIndex: 0, rateIDs: ['zone-9'], selectedRateIDs: []}]);
            expect(summarize(getSections(allRates))).toStrictEqual([{title: translateLocal('common.all'), sectionIndex: 4, rateIDs: sortedRateIDs, selectedRateIDs: []}]);
            expect(getSections(allRates, {selectedRateID: 'cuba'})).toStrictEqual(getSections(allRates, {selectedRateID: 'cuba'}));
        });
    });

    describe('getCustomUnitID', () => {
        it('should return the correct custom unit ID', async () => {
            const policy: Policy = {
                ...getFakePolicy(),
                id: policyID,
                customUnits: {
                    [CONST.CUSTOM_UNITS.DISTANCE_UNIT_KILOMETERS]: {
                        name: CONST.CUSTOM_UNITS.NAME_PER_DIEM_INTERNATIONAL,
                        customUnitID: CONST.CUSTOM_UNITS.DISTANCE_UNIT_KILOMETERS,
                        rates: {},
                    },
                },
            };

            await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${policyID}`, policy);

            const customUnitID = getCustomUnitID(report, parentReport, policy);
            expect(customUnitID.customUnitID).toBe(CONST.CUSTOM_UNITS.DISTANCE_UNIT_KILOMETERS);
        });

        it('should return fake P2P ID if the policy does not have a custom unit', async () => {
            const policy: Policy = {
                ...getFakePolicy(),
                customUnits: {},
            };

            await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${policyID}`, policy);

            const customUnitID = getCustomUnitID(report, parentReport, policy);
            expect(customUnitID.customUnitID).toBe(CONST.CUSTOM_UNITS.FAKE_P2P_ID);
        });
    });

    describe('getTimeForDisplay', () => {
        function buildPerDiemTransaction(start: string, end: string): Transaction {
            const transaction = createRandomTransaction(1);
            return {
                ...transaction,
                comment: {
                    ...transaction.comment,
                    customUnit: {customUnitID: 'per-diem', attributes: {dates: {start, end}}},
                },
            };
        }

        it('shows each time with a readable date instead of the machine date', () => {
            // Given a per-diem expense that runs from noon on one day to noon the next, read in UTC as the test runner is
            const transaction = buildPerDiemTransaction('2026-01-22T12:00:00Z', '2026-01-23T12:00:00Z');

            // When its time range is shown on the confirmation page
            // Then each end shows the time followed by a numeric date in the English order, rather than the `yyyy-MM-dd` it
            // is stored as
            expect(getTimeForDisplay(transaction, undefined)).toBe('12:00 PM, 01/22/2026 - 12:00 PM, 01/23/2026');
        });

        it('orders the date the way the language does', () => {
            // Given the same per-diem expense, shown to a German user
            const transaction = buildPerDiemTransaction('2026-01-22T12:00:00Z', '2026-01-23T12:00:00Z');

            // When its time range is shown on the confirmation page
            // Then the time still comes first, and the date uses the German day-first order and separators
            expect(getTimeForDisplay(transaction, de)).toBe('12:00, 22.01.2026 - 12:00, 23.01.2026');
        });

        it('leaves an end blank when its date cannot be read', () => {
            // Given a per-diem expense whose end date is not a valid date
            const transaction = buildPerDiemTransaction('2026-01-22T12:00:00Z', 'not a date');

            // When its time range is shown
            // Then the unreadable end is blank instead of the confirmation page throwing a RangeError
            expect(getTimeForDisplay(transaction, undefined)).toBe('12:00 PM, 01/22/2026 - ');
        });
    });
});
