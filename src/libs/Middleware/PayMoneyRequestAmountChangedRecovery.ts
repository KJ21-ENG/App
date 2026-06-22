import type {OnyxKey} from 'react-native-onyx';
import {openReport} from '@libs/actions/Report';
import {WRITE_COMMANDS} from '@libs/API/types';
import {getMicroSecondOnyxErrorWithTranslationKey} from '@libs/ErrorUtils';
import type {Middleware} from '@libs/Request';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {AnyOnyxUpdate} from '@src/types/onyx/Request';
import type Response from '@src/types/onyx/Response';

const PAY_MONEY_REQUEST_COMMANDS = new Set<string>([WRITE_COMMANDS.PAY_MONEY_REQUEST, WRITE_COMMANDS.PAY_MONEY_REQUEST_WITH_WALLET]);
const REPORT_TOTAL_FIELDS = ['total', 'nonReimbursableTotal', 'unheldTotal', 'unheldNonReimbursableTotal'];
const SAFE_REPORT_ROLLBACK_FIELDS = ['statusNum', 'stateNum', 'hasOutstandingChildRequest', 'lastMessageText', 'lastMessageHtml', 'lastVisibleActionCreated', 'pendingFields', 'nextStep'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAmountChangedError() {
    return getMicroSecondOnyxErrorWithTranslationKey('iou.error.amountChanged', 0);
}

function hasAmountChangedSignal<TKey extends OnyxKey>(response: Response<TKey>): boolean {
    const signal = `${response.type ?? ''} ${response.message ?? ''}`.toLowerCase();
    return Number(response.jsonCode) !== CONST.JSON_CODE.SUCCESS && signal.includes('amount') && signal.includes('changed');
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

const PayMoneyRequestAmountChangedRecovery: Middleware = (requestResponse, request) =>
    requestResponse.then((response) => {
        if (!response || !PAY_MONEY_REQUEST_COMMANDS.has(request.command) || !hasAmountChangedSignal(response)) {
            return response;
        }

        const iouReportID = request.data?.iouReportID as string | undefined;
        if (!iouReportID) {
            return response;
        }

        request.failureData = getFilteredFailureData(request.failureData as AnyOnyxUpdate[] | undefined, iouReportID, request.data?.reportActionID as string | undefined) as typeof request.failureData;

        if (!responseIncludesReportTotal(response, iouReportID)) {
            openReport({reportID: iouReportID, introSelected: undefined, betas: undefined});
        }

        return response;
    });

export default PayMoneyRequestAmountChangedRecovery;
