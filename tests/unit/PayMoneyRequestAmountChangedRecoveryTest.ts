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
const AMOUNT_CHANGED_TYPE = 'amountChanged';
type PayMoneyRequestAmountChangedRecoveryRequest = Parameters<typeof PayMoneyRequestAmountChangedRecovery>[1];

function getReportKey(reportID = REPORT_ID) {
    return `${ONYXKEYS.COLLECTION.REPORT}${reportID}` as const;
}

function getReportActionsKey(reportID = REPORT_ID) {
    return `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}` as const;
}

function buildPayRequest(reportID = REPORT_ID, reportActionID = REPORT_ACTION_ID): PayMoneyRequestAmountChangedRecoveryRequest {
    return {
        command: WRITE_COMMANDS.PAY_MONEY_REQUEST,
        data: {
            iouReportID: reportID,
            reportActionID,
            amount: 10000,
        },
        failureData: [
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: getReportActionsKey(reportID),
                value: {
                    [reportActionID]: {
                        errors: getMicroSecondOnyxErrorWithTranslationKey('iou.error.other', 0),
                    },
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: getReportKey(reportID),
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
                key: getReportKey(reportID),
                value: {
                    total: -10000,
                    nonReimbursableTotal: 0,
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: getReportKey(reportID),
                value: {
                    errors: getMicroSecondOnyxErrorWithTranslationKey('common.genericErrorMessage', 0),
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.RAM_ONLY_REPORT_LOADING_STATE}${reportID}`,
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
                type: AMOUNT_CHANGED_TYPE,
                onyxData: [
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: getReportKey(),
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
                key: getReportActionsKey(),
                value: {
                    [REPORT_ACTION_ID]: {
                        errors: getMicroSecondOnyxErrorWithTranslationKey('iou.error.amountChanged', 0),
                    },
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: getReportKey(),
                value: {
                    statusNum: CONST.REPORT.STATUS_NUM.OPEN,
                    stateNum: CONST.REPORT.STATE_NUM.SUBMITTED,
                    pendingFields: {preview: null, reimbursed: null, partial: null, nextStep: null},
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: getReportKey(),
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
                type: AMOUNT_CHANGED_TYPE,
            }),
            request,
            false,
        );

        expect(openReport).toHaveBeenCalledWith({reportID: REPORT_ID, introSelected: undefined, betas: undefined});
    });

    it('clears old amount-changed report action errors after a later successful Pay', async () => {
        const reportID = 'successful-pay-report';
        const reportActionID = 'failed-pay-action';
        const failedRequest = buildPayRequest(reportID, reportActionID);

        await PayMoneyRequestAmountChangedRecovery(
            Promise.resolve({
                jsonCode: CONST.JSON_CODE.EXP_ERROR,
                type: AMOUNT_CHANGED_TYPE,
            }),
            failedRequest,
            false,
        );

        const successfulRequest = buildPayRequest(reportID, 'successful-pay-action');
        const response = await PayMoneyRequestAmountChangedRecovery(
            Promise.resolve({
                jsonCode: CONST.JSON_CODE.SUCCESS,
                onyxData: [],
            }),
            successfulRequest,
            false,
        );

        expect(response?.onyxData).toContainEqual({
            onyxMethod: Onyx.METHOD.MERGE,
            key: getReportActionsKey(reportID),
            value: {
                [reportActionID]: {
                    errors: null,
                },
            },
        });
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
