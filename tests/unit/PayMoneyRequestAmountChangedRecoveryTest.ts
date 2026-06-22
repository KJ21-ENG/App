import Onyx from 'react-native-onyx';
import {openReport} from '@libs/actions/Report';
import {WRITE_COMMANDS} from '@libs/API/types';
import {getMicroSecondOnyxErrorWithTranslationKey} from '@libs/ErrorUtils';
import PayMoneyRequestAmountChangedRecovery from '@libs/Middleware/PayMoneyRequestAmountChangedRecovery';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';

jest.mock('@libs/actions/Report', () => ({
    openReport: jest.fn(),
}));

const REPORT_ID = '123';
const REPORT_ACTION_ID = '456';
const REPORT_KEY = `${ONYXKEYS.COLLECTION.REPORT}${REPORT_ID}` as const;
const REPORT_ACTIONS_KEY = `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${REPORT_ID}` as const;
type PayMoneyRequestAmountChangedRecoveryRequest = Parameters<typeof PayMoneyRequestAmountChangedRecovery>[1];

function buildPayRequest(): PayMoneyRequestAmountChangedRecoveryRequest {
    return {
        command: WRITE_COMMANDS.PAY_MONEY_REQUEST,
        data: {
            iouReportID: REPORT_ID,
            reportActionID: REPORT_ACTION_ID,
            amount: 10000,
        },
        failureData: [
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: REPORT_ACTIONS_KEY,
                value: {
                    [REPORT_ACTION_ID]: {
                        errors: getMicroSecondOnyxErrorWithTranslationKey('iou.error.other', 0),
                    },
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: REPORT_KEY,
                value: {
                    total: -10000,
                    nonReimbursableTotal: 0,
                    unheldTotal: -9000,
                    unheldNonReimbursableTotal: 0,
                    statusNum: CONST.REPORT.STATUS_NUM.OPEN,
                    stateNum: CONST.REPORT.STATE_NUM.SUBMITTED,
                    pendingFields: {preview: null, reimbursed: null, partial: null, nextStep: null},
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: REPORT_KEY,
                value: {
                    total: -10000,
                    nonReimbursableTotal: 0,
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: REPORT_KEY,
                value: {
                    errors: getMicroSecondOnyxErrorWithTranslationKey('common.genericErrorMessage', 0),
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.RAM_ONLY_REPORT_LOADING_STATE}${REPORT_ID}`,
                value: {isActionLoading: false},
            },
        ],
    } as PayMoneyRequestAmountChangedRecoveryRequest;
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('PayMoneyRequestAmountChangedRecovery', () => {
    it('preserves refreshed response totals and filters partial-hold/Search generic failure data for amount-changed Pay failures', async () => {
        const request = buildPayRequest();

        await PayMoneyRequestAmountChangedRecovery(
            Promise.resolve({
                jsonCode: CONST.JSON_CODE.EXP_ERROR,
                message: 'The requested amount has changed',
                onyxData: [
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: REPORT_KEY,
                        value: {
                            total: -10001,
                            nonReimbursableTotal: 0,
                        },
                    },
                ],
            }),
            request,
            false,
        );

        expect(openReport).not.toHaveBeenCalled();
        expect(request.failureData).toEqual([
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: REPORT_ACTIONS_KEY,
                value: {
                    [REPORT_ACTION_ID]: {
                        errors: getMicroSecondOnyxErrorWithTranslationKey('iou.error.amountChanged', 0),
                    },
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: REPORT_KEY,
                value: {
                    statusNum: CONST.REPORT.STATUS_NUM.OPEN,
                    stateNum: CONST.REPORT.STATE_NUM.SUBMITTED,
                    pendingFields: {preview: null, reimbursed: null, partial: null, nextStep: null},
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: REPORT_KEY,
                value: {
                    errors: getMicroSecondOnyxErrorWithTranslationKey('iou.error.amountChanged', 0),
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.RAM_ONLY_REPORT_LOADING_STATE}${REPORT_ID}`,
                value: {isActionLoading: false},
            },
        ]);
    });

    it('refreshes the report when the amount-changed response has no corrected report total', async () => {
        const request = buildPayRequest();

        await PayMoneyRequestAmountChangedRecovery(
            Promise.resolve({
                jsonCode: CONST.JSON_CODE.EXP_ERROR,
                message: 'The requested amount has changed',
            }),
            request,
            false,
        );

        expect(openReport).toHaveBeenCalledWith({reportID: REPORT_ID, introSelected: undefined, betas: undefined});
    });

    it('leaves unrelated Pay failures on the existing failureData path', async () => {
        const request = buildPayRequest();
        const originalFailureData = request.failureData;

        await PayMoneyRequestAmountChangedRecovery(
            Promise.resolve({
                jsonCode: CONST.JSON_CODE.BAD_REQUEST,
                message: 'Billing card required',
            }),
            request,
            false,
        );

        expect(openReport).not.toHaveBeenCalled();
        expect(request.failureData).toBe(originalFailureData);
    });
});
