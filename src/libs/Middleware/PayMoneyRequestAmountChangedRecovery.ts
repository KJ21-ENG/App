import Onyx, {type OnyxKey} from 'react-native-onyx';
import {openReport} from '@libs/actions/Report';
import {WRITE_COMMANDS} from '@libs/API/types';
import {getMicroSecondOnyxErrorWithTranslationKey} from '@libs/ErrorUtils';
import type {Middleware} from '@libs/Request';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {AnyOnyxUpdate} from '@src/types/onyx/Request';
import type Response from '@src/types/onyx/Response';

const PAY_MONEY_REQUEST_COMMANDS = new Set<string>([WRITE_COMMANDS.PAY_MONEY_REQUEST, WRITE_COMMANDS.PAY_MONEY_REQUEST_WITH_WALLET]);
const AMOUNT_CHANGED_PAY_REJECTION_TYPE = 'amountChanged';
const REPORT_TOTAL_FIELDS = ['total', 'nonReimbursableTotal', 'unheldTotal', 'unheldNonReimbursableTotal'];
const SAFE_REPORT_ROLLBACK_FIELDS = ['statusNum', 'stateNum', 'hasOutstandingChildRequest', 'lastMessageText', 'lastMessageHtml', 'lastVisibleActionCreated', 'pendingFields', 'nextStep'];
const amountChangedReportActionIDsByReportID = new Map<string, Set<string>>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAmountChangedError() {
    return getMicroSecondOnyxErrorWithTranslationKey('iou.error.amountChanged', 0);
}

function isAmountChangedPayFailure<TKey extends OnyxKey>(response: Response<TKey>): boolean {
    return Number(response.jsonCode) === CONST.JSON_CODE.EXP_ERROR && response.type === AMOUNT_CHANGED_PAY_REJECTION_TYPE;
}

function responseIncludesReportTotal<TKey extends OnyxKey>(response: Response<TKey>, reportID: string): boolean {
    const reportKey = `${ONYXKEYS.COLLECTION.REPORT}${reportID}`;
    return (response.onyxData ?? []).some((update) => update.key === reportKey && isRecord(update.value) && REPORT_TOTAL_FIELDS.some((field) => field in update.value));
}

function getFilteredReportRollback(value: unknown): Record<string, unknown> | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    return SAFE_REPORT_ROLLBACK_FIELDS.reduce<Record<string, unknown>>((filteredValue, field) => {
        if (field in value) {
            filteredValue[field] = value[field];
        }
        return filteredValue;
    }, {});
}

function getFilteredFailureData(failureData: AnyOnyxUpdate[] | undefined, reportID: string, reportActionID: string | undefined): AnyOnyxUpdate[] | undefined {
    if (!failureData) {
        return undefined;
    }

    const reportKey = `${ONYXKEYS.COLLECTION.REPORT}${reportID}`;
    const reportActionsKey = `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`;

    return failureData.flatMap((update) => {
        if (update.key === reportKey) {
            const filteredValue = getFilteredReportRollback(update.value);
            if (!filteredValue) {
                return [update];
            }

            if (isRecord(update.value) && 'errors' in update.value) {
                filteredValue.errors = getAmountChangedError();
            }

            return Object.keys(filteredValue).length > 0 ? [{...update, value: filteredValue}] : [];
        }

        if (update.key === reportActionsKey && reportActionID && isRecord(update.value) && isRecord(update.value[reportActionID])) {
            return [
                {
                    ...update,
                    value: {
                        ...update.value,
                        [reportActionID]: {
                            ...update.value[reportActionID],
                            errors: getAmountChangedError(),
                        },
                    },
                },
            ];
        }

        return [update];
    });
}

function trackAmountChangedReportAction(reportID: string, reportActionID: string | undefined) {
    if (!reportActionID) {
        return;
    }

    if (!amountChangedReportActionIDsByReportID.has(reportID)) {
        amountChangedReportActionIDsByReportID.set(reportID, new Set());
    }

    amountChangedReportActionIDsByReportID.get(reportID)?.add(reportActionID);
}

function clearTrackedAmountChangedReportActions<TKey extends OnyxKey>(response: Response<TKey>, reportID: string) {
    const reportActionIDs = amountChangedReportActionIDsByReportID.get(reportID);
    if (!reportActionIDs || reportActionIDs.size === 0) {
        return;
    }

    response.onyxData = [
        ...(response.onyxData ?? []),
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`,
            value: Object.fromEntries([...reportActionIDs].map((reportActionID) => [reportActionID, {errors: null}])),
        },
    ] as Response<TKey>['onyxData'];
    amountChangedReportActionIDsByReportID.delete(reportID);
}

const PayMoneyRequestAmountChangedRecovery: Middleware = (requestResponse, request) =>
    requestResponse.then((response) => {
        if (!response || !PAY_MONEY_REQUEST_COMMANDS.has(request.command)) {
            return response;
        }

        const iouReportID = request.data?.iouReportID as string | undefined;
        if (!iouReportID) {
            return response;
        }

        if (Number(response.jsonCode) === CONST.JSON_CODE.SUCCESS) {
            clearTrackedAmountChangedReportActions(response, iouReportID);
            return response;
        }

        if (!isAmountChangedPayFailure(response)) {
            return response;
        }

        const reportActionID = request.data?.reportActionID as string | undefined;
        trackAmountChangedReportAction(iouReportID, reportActionID);
        request.failureData = getFilteredFailureData(request.failureData as AnyOnyxUpdate[] | undefined, iouReportID, reportActionID) as typeof request.failureData;

        if (!responseIncludesReportTotal(response, iouReportID)) {
            openReport({reportID: iouReportID, introSelected: undefined, betas: undefined});
        }

        return response;
    });

export default PayMoneyRequestAmountChangedRecovery;
