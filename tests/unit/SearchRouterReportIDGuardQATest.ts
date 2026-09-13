import {getContextualReportData} from '@components/Search/SearchRouter/SearchRouterUtils';

import SCREENS from '@src/SCREENS';

import type {NavigationState} from '@react-navigation/native';

import createMock from '../utils/createMock';

// QA-only scratch coverage. Production files are identical to PR #100942.
const cases: Array<{label: string; params: object | undefined; expected: string | undefined}> = [
    {label: 'absent params', params: undefined, expected: undefined},
    {label: 'missing reportID', params: {}, expected: undefined},
    {label: 'undefined reportID', params: {reportID: undefined}, expected: undefined},
    {label: 'null reportID', params: {reportID: null}, expected: undefined},
    {label: 'number reportID', params: {reportID: 12345}, expected: undefined},
    {label: 'boolean reportID', params: {reportID: true}, expected: undefined},
    {label: 'array reportID', params: {reportID: ['12345']}, expected: undefined},
    {label: 'object reportID', params: {reportID: {id: '12345'}}, expected: undefined},
    {label: 'valid string reportID', params: {reportID: '12345'}, expected: '12345'},
    {label: 'empty string reportID', params: {reportID: ''}, expected: ''},
];
for (const name of [SCREENS.REPORT, SCREENS.RIGHT_MODAL.EXPENSE_REPORT]) {
    for (const nested of [false, true]) {
        for (const overlay of [false, true]) {
            describe(`${name} nested=${nested} SearchRouter=${overlay}`, () => {
                it.each(cases)('$label does not throw and preserves exact context contract', ({params, expected}) => {
                    const reportRoute = {name, ...(params === undefined ? {} : {params})};
                    const underlyingRoute = nested ? {name: 'RootNavigator', state: {index: 0, routes: [reportRoute]}} : reportRoute;
                    const state = createMock<NavigationState>({
                        index: overlay ? 1 : 0,
                        routes: overlay ? [underlyingRoute, {name: SCREENS.SEARCH_ROUTER.ROOT}] : [underlyingRoute],
                    });
                    expect(() => getContextualReportData(state)).not.toThrow();
                    expect(getContextualReportData(state)).toEqual({contextualReportID: expected, isSearchRouterScreen: overlay});
                });
            });
        }
    }
}
