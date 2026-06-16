import type {OnyxEntry, OnyxUpdate} from 'react-native-onyx';
import Onyx from 'react-native-onyx';
import * as API from '@libs/API';
import type {MarkTransactionViolationAsResolvedParams, RejectExpenseReportParams, RejectMoneyRequestParams, SetNameValuePairParams} from '@libs/API/parameters';
import {WRITE_COMMANDS} from '@libs/API/types';
import DateUtils from '@libs/DateUtils';
import {getMicroSecondOnyxErrorWithTranslationKey} from '@libs/ErrorUtils';
import {addIssue92246DebugLog} from '@libs/Issue92246Debug';
import isSearchTopmostFullScreenRoute from '@libs/Navigation/helpers/isSearchTopmostFullScreenRoute';
import {navigationRef} from '@libs/Navigation/Navigation';
import {buildNextStepNew, buildOptimisticNextStep} from '@libs/NextStepUtils';
import {getLoginByAccountID} from '@libs/PersonalDetailsUtils';
import {isDelayedSubmissionEnabled} from '@libs/PolicyUtils';
import {getAllReportActions, getIOUActionForReportID} from '@libs/ReportActionsUtils';
import {
    buildOptimisticCreatedReportAction,
    buildOptimisticExpenseReport,
    buildOptimisticIOUReportAction,
    buildOptimisticMarkedAsResolvedReportAction,
    buildOptimisticMoneyRequestEntities,
    buildOptimisticMovedTransactionAction,
    buildOptimisticRejectReportAction,
    buildOptimisticRejectReportActionComment,
    buildOptimisticReportLevelRejectAction,
    buildOptimisticReportLevelRejectCommentAction,
    buildOptimisticReportPreview,
    buildOptimisticSelfDMReport,
    buildOptimisticUnreportedTransactionAction,
    findSelfDMReportID,
    generateReportID,
    getDisplayedReportID,
    getParsedComment,
    getReportTransactions,
    hasOutstandingChildRequest,
    isIOUReport,
    isOpenReport,
} from '@libs/ReportUtils';
import {getAmount, getCurrency} from '@libs/TransactionUtils';
import type {AvatarSource} from '@libs/UserAvatarUtils';
import {notifyNewAction} from '@userActions/Report';
import CONST from '@src/CONST';
import NAVIGATORS from '@src/NAVIGATORS';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Route} from '@src/ROUTES';
import ROUTES from '@src/ROUTES';
import SCREENS from '@src/SCREENS';
import type * as OnyxTypes from '@src/types/onyx';
import {isEmptyObject} from '@src/types/utils/EmptyObject';
import {getAllReports, getAllTransactions, getAllTransactionViolations} from '.';

type RejectMoneyRequestData = {
    optimisticData: Array<
        OnyxUpdate<
            | typeof ONYXKEYS.COLLECTION.REPORT
            | typeof ONYXKEYS.COLLECTION.TRANSACTION
            | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS
            | typeof ONYXKEYS.COLLECTION.REPORT_METADATA
            | typeof ONYXKEYS.COLLECTION.RAM_ONLY_REPORT_LOADING_STATE
            | typeof ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS
            | typeof ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS
            | typeof ONYXKEYS.SELF_DM_REPORT_ID
        >
    >;
    successData: Array<
        OnyxUpdate<typeof ONYXKEYS.COLLECTION.REPORT | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS | typeof ONYXKEYS.COLLECTION.REPORT_METADATA | typeof ONYXKEYS.COLLECTION.TRANSACTION>
    >;
    failureData: Array<
        OnyxUpdate<
            | typeof ONYXKEYS.COLLECTION.REPORT
            | typeof ONYXKEYS.COLLECTION.TRANSACTION
            | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS
            | typeof ONYXKEYS.COLLECTION.REPORT_METADATA
            | typeof ONYXKEYS.COLLECTION.RAM_ONLY_REPORT_LOADING_STATE
            | typeof ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS
            | typeof ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS
        >
    >;
    parameters: RejectMoneyRequestParams;
    urlToNavigateBack: Route | undefined;
    debugContext: Issue92246DebugContext;
};

type RejectMoneyRequestOptions = {
    sharedRejectedToReportID?: string;
    existingRejectedReport?: OnyxEntry<OnyxTypes.Report>;
    setExistingRejectedReport?: (report: OnyxEntry<OnyxTypes.Report>) => void;
};

type Issue92246DebugContext = {
    transactionID?: string;
    sourceReportID?: string;
    sourceChatReportID?: string;
    childReportID?: string;
    rejectedToReportID?: string;
    selfDMReportID?: string;
    rejectedActionReportActionID?: string;
    rejectedCommentReportActionID?: string;
    reportPreviewReportActionID?: string;
    createdIOUReportActionID?: string;
    expenseMovedReportActionID?: string;
    expenseCreatedReportActionID?: string;
    selfDMCreatedReportActionID?: string;
    urlToNavigateBack?: Route;
};

type Issue92246DebugOnyxUpdate = {
    onyxMethod: unknown;
    key: string;
    value: unknown;
};

const ISSUE_92246_SETTLED_SNAPSHOT_DELAYS = [250, 1000, 3000, 7000];

function getObjectKeys(value: unknown): string[] | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    return Object.keys(value as Record<string, unknown>);
}

function summarizeWaypoints(waypoints: unknown) {
    if (!waypoints || typeof waypoints !== 'object') {
        return waypoints ?? null;
    }

    return Object.fromEntries(
        Object.entries(waypoints as Record<string, Record<string, unknown>>).map(([key, waypoint]) => [
            key,
            {
                name: waypoint?.name,
                address: waypoint?.address,
                lat: waypoint?.lat,
                lng: waypoint?.lng,
            },
        ]),
    );
}

function summarizeRoutes(routes: unknown) {
    if (!routes || typeof routes !== 'object') {
        return routes ?? null;
    }

    return Object.fromEntries(
        Object.entries(routes as Record<string, Record<string, unknown>>).map(([key, route]) => [
            key,
            {
                distance: route?.distance,
                geometryType: (route?.geometry as Record<string, unknown> | undefined)?.type,
                hasCoordinates: Array.isArray((route?.geometry as Record<string, unknown> | undefined)?.coordinates),
            },
        ]),
    );
}

function summarizeTransaction(transaction: OnyxEntry<OnyxTypes.Transaction>) {
    if (!transaction) {
        return null;
    }

    return {
        keys: getObjectKeys(transaction),
        transactionID: transaction.transactionID,
        reportID: transaction.reportID,
        transactionThreadReportID: transaction.transactionThreadReportID,
        iouRequestType: transaction.iouRequestType,
        amount: transaction.amount,
        modifiedAmount: transaction.modifiedAmount,
        currency: transaction.currency,
        modifiedCurrency: transaction.modifiedCurrency,
        merchant: transaction.merchant,
        modifiedMerchant: transaction.modifiedMerchant,
        category: transaction.category,
        tag: transaction.tag,
        created: transaction.created,
        modifiedCreated: transaction.modifiedCreated,
        pendingAction: transaction.pendingAction,
        pendingFields: transaction.pendingFields,
        errorFields: transaction.errorFields,
        errors: transaction.errors,
        routes: summarizeRoutes(transaction.routes),
        modifiedWaypoints: summarizeWaypoints(transaction.modifiedWaypoints),
        comment: transaction.comment
            ? {
                  keys: getObjectKeys(transaction.comment),
                  comment: transaction.comment.comment,
                  type: transaction.comment.type,
                  customUnit: transaction.comment.customUnit,
                  units: transaction.comment.units,
                  waypoints: summarizeWaypoints(transaction.comment.waypoints),
                  odometerStart: transaction.comment.odometerStart,
                  odometerEnd: transaction.comment.odometerEnd,
                  dismissedViolations: transaction.comment.dismissedViolations,
                  source: transaction.comment.source,
                  originalTransactionID: transaction.comment.originalTransactionID,
              }
            : null,
    };
}

function summarizeReport(report: OnyxEntry<OnyxTypes.Report>) {
    if (!report) {
        return null;
    }

    return {
        keys: getObjectKeys(report),
        reportID: report.reportID,
        type: report.type,
        chatType: report.chatType,
        policyID: report.policyID,
        chatReportID: report.chatReportID,
        parentReportID: report.parentReportID,
        parentReportActionID: report.parentReportActionID,
        ownerAccountID: report.ownerAccountID,
        managerID: report.managerID,
        total: report.total,
        currency: report.currency,
        stateNum: report.stateNum,
        statusNum: report.statusNum,
        transactionCount: report.transactionCount,
        hasOutstandingChildRequest: report.hasOutstandingChildRequest,
        lastMessageText: report.lastMessageText,
        lastVisibleActionCreated: report.lastVisibleActionCreated,
        lastActionType: report.lastActionType,
        pendingAction: report.pendingAction,
        pendingFields: report.pendingFields,
        errorFields: report.errorFields,
        errors: report.errors,
        isDeletedParentAction: report.isDeletedParentAction,
    };
}

function summarizeOriginalMessage(originalMessage: unknown) {
    if (!originalMessage || typeof originalMessage !== 'object') {
        return originalMessage ?? null;
    }

    const rawOriginalMessage = originalMessage as Record<string, unknown>;
    const fieldsToPick = [
        'type',
        'IOUReportID',
        'IOUTransactionID',
        'amount',
        'currency',
        'comment',
        'deleted',
        'lastModified',
        'childReportID',
        'parentReportID',
        'parentReportActionID',
        'customUnitName',
        'customUnitRateName',
        'customUnitSubRateName',
        'rateName',
        'rate',
        'unit',
    ];

    return {
        keys: Object.keys(rawOriginalMessage),
        picked: Object.fromEntries(fieldsToPick.filter((key) => key in rawOriginalMessage).map((key) => [key, rawOriginalMessage[key]])),
    };
}

function summarizeActionMessage(message: unknown) {
    if (!message) {
        return null;
    }

    const summarizeMessageItem = (item: unknown) => {
        if (!item || typeof item !== 'object') {
            return item ?? null;
        }

        const rawItem = item as Record<string, unknown>;
        return {
            keys: Object.keys(rawItem),
            type: rawItem.type,
            text: rawItem.text,
            htmlLength: typeof rawItem.html === 'string' ? rawItem.html.length : undefined,
        };
    };

    if (Array.isArray(message)) {
        return message.slice(0, 3).map(summarizeMessageItem);
    }

    return summarizeMessageItem(message);
}

function summarizeReportAction(action: OnyxEntry<OnyxTypes.ReportAction>) {
    if (!action) {
        return null;
    }

    return {
        keys: getObjectKeys(action),
        reportActionID: action.reportActionID,
        actionName: action.actionName,
        created: action.created,
        actorAccountID: action.actorAccountID,
        reportID: action.reportID,
        parentReportID: action.parentReportID,
        childReportID: action.childReportID,
        childType: action.childType,
        childStateNum: action.childStateNum,
        childStatusNum: action.childStatusNum,
        childMoneyRequestCount: action.childMoneyRequestCount,
        childLastMoneyRequestComment: action.childLastMoneyRequestComment,
        childLastVisibleActionCreated: action.childLastVisibleActionCreated,
        childOwnerAccountID: action.childOwnerAccountID,
        pendingAction: action.pendingAction,
        errorFields: action.errorFields,
        errors: action.errors,
        originalMessage: summarizeOriginalMessage(action.originalMessage),
        message: summarizeActionMessage(action.message),
    };
}

function summarizeReportActionPatchMap(value: unknown) {
    if (!value || typeof value !== 'object') {
        return value ?? null;
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([reportActionID, actionPatch]) => [
            reportActionID,
            actionPatch && typeof actionPatch === 'object' && ('reportActionID' in actionPatch || 'actionName' in actionPatch)
                ? summarizeReportAction(actionPatch as OnyxTypes.ReportAction)
                : actionPatch,
        ]),
    );
}

function summarizeReportActions(reportID: string | undefined, highlightedReportActionIDs: Array<string | undefined> = []) {
    if (!reportID) {
        return null;
    }

    const reportActions = getAllReportActions(reportID);
    const actionValues = Object.values(reportActions ?? {});
    const sortedActions = actionValues.sort((firstAction, secondAction) => (firstAction.created ?? '').localeCompare(secondAction.created ?? ''));
    const highlightedActions = Object.fromEntries(
        highlightedReportActionIDs
            .filter((reportActionID): reportActionID is string => !!reportActionID)
            .map((reportActionID) => [reportActionID, summarizeReportAction(reportActions?.[reportActionID])]),
    );

    return {
        reportID,
        actionCount: actionValues.length,
        actionIDs: Object.keys(reportActions ?? {}),
        highlightedActions,
        lastActions: sortedActions.slice(-6).map(summarizeReportAction),
    };
}

function summarizeOnyxUpdateValue(key: string, value: unknown) {
    if (value === null || value === undefined) {
        return value ?? null;
    }

    if (key.startsWith(ONYXKEYS.COLLECTION.REPORT_ACTIONS)) {
        return summarizeReportActionPatchMap(value);
    }

    if (key.startsWith(ONYXKEYS.COLLECTION.TRANSACTION)) {
        return summarizeTransaction(value as OnyxTypes.Transaction);
    }

    if (key.startsWith(ONYXKEYS.COLLECTION.REPORT_METADATA) || key.startsWith(ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS)) {
        return value;
    }

    if (key.startsWith(ONYXKEYS.COLLECTION.REPORT)) {
        return summarizeReport(value as OnyxTypes.Report);
    }

    return value;
}

function summarizeOnyxUpdates(updates: ReadonlyArray<Issue92246DebugOnyxUpdate>, debugContext: Issue92246DebugContext) {
    return {
        count: updates.length,
        keys: updates.map((update) => update.key),
        updates: updates.map((update) => ({
            method: update.onyxMethod,
            key: update.key,
            value: summarizeOnyxUpdateValue(update.key, update.value),
        })),
        highlightedContext: debugContext,
    };
}

function getNavigationDebugState() {
    const currentRoute = navigationRef.getCurrentRoute();
    const rootState = navigationRef.getRootState();

    return {
        currentRouteName: currentRoute?.name,
        currentRouteParams: currentRoute?.params,
        rootRouteNames: rootState?.routes.map((route) => route.name),
    };
}

function getUniqueReportIDs(reportIDs: Array<string | undefined>) {
    return [...new Set(reportIDs.filter((reportID): reportID is string => !!reportID))];
}

function buildIssue92246OnyxSnapshot(debugContext: Issue92246DebugContext) {
    const allTransactions = getAllTransactions();
    const allReports = getAllReports();
    const sourceReport = debugContext.sourceReportID ? allReports?.[`${ONYXKEYS.COLLECTION.REPORT}${debugContext.sourceReportID}`] : undefined;
    const sourceChatReportID = debugContext.sourceChatReportID ?? sourceReport?.chatReportID;
    const transaction = debugContext.transactionID ? allTransactions?.[`${ONYXKEYS.COLLECTION.TRANSACTION}${debugContext.transactionID}`] : undefined;
    const sourceIOUAction =
        debugContext.sourceReportID && debugContext.transactionID ? getIOUActionForReportID(debugContext.sourceReportID, debugContext.transactionID) : undefined;
    const rejectedToReportID = debugContext.rejectedToReportID ?? debugContext.selfDMReportID;
    const childReportID = debugContext.childReportID ?? sourceIOUAction?.childReportID ?? transaction?.transactionThreadReportID;
    const reportIDs = getUniqueReportIDs([debugContext.sourceReportID, sourceChatReportID, childReportID, rejectedToReportID, debugContext.selfDMReportID]);
    const reportSummaries = Object.fromEntries(reportIDs.map((reportID) => [reportID, summarizeReport(allReports?.[`${ONYXKEYS.COLLECTION.REPORT}${reportID}`])]));

    return {
        debugContext: {
            ...debugContext,
            sourceChatReportID,
            childReportID,
            rejectedToReportID,
        },
        navigation: getNavigationDebugState(),
        transaction: summarizeTransaction(transaction),
        reports: reportSummaries,
        reportTransactions: Object.fromEntries(
            reportIDs.map((reportID) => [
                reportID,
                getReportTransactions(reportID).map((reportTransaction) => ({
                    transactionID: reportTransaction.transactionID,
                    reportID: reportTransaction.reportID,
                    amount: reportTransaction.amount,
                    modifiedAmount: reportTransaction.modifiedAmount,
                    currency: reportTransaction.currency,
                    modifiedCurrency: reportTransaction.modifiedCurrency,
                    iouRequestType: reportTransaction.iouRequestType,
                })),
            ]),
        ),
        reportActions: {
            sourceExpenseReport: summarizeReportActions(debugContext.sourceReportID, [debugContext.rejectedActionReportActionID, debugContext.rejectedCommentReportActionID]),
            sourceChatReport: summarizeReportActions(sourceChatReportID, [sourceReport?.parentReportActionID, debugContext.reportPreviewReportActionID]),
            childThreadReport: summarizeReportActions(childReportID, [debugContext.expenseMovedReportActionID]),
            rejectedToReport: summarizeReportActions(rejectedToReportID, [debugContext.createdIOUReportActionID, debugContext.expenseCreatedReportActionID, debugContext.selfDMCreatedReportActionID]),
            selfDMReport: summarizeReportActions(debugContext.selfDMReportID, [debugContext.createdIOUReportActionID, debugContext.selfDMCreatedReportActionID]),
        },
        derivedActions: {
            sourceIOUAction: summarizeReportAction(sourceIOUAction),
            rejectedToReportIOUAction:
                rejectedToReportID && debugContext.transactionID ? summarizeReportAction(getIOUActionForReportID(rejectedToReportID, debugContext.transactionID)) : null,
        },
    };
}

function addIssue92246StateSnapshotLog(event: string, debugContext: Issue92246DebugContext, extraDetails?: Record<string, unknown>) {
    addIssue92246DebugLog(event, {
        ...extraDetails,
        snapshot: buildIssue92246OnyxSnapshot(debugContext),
    });
}

function scheduleIssue92246SettledStateSnapshots(debugContext: Issue92246DebugContext) {
    addIssue92246StateSnapshotLog('rejectMoneyRequest after API.write immediate state', debugContext, {delayMS: 0});
    ISSUE_92246_SETTLED_SNAPSHOT_DELAYS.forEach((delayMS) => {
        setTimeout(() => {
            addIssue92246StateSnapshotLog('rejectMoneyRequest settled state snapshot', debugContext, {delayMS});
        }, delayMS);
    });
}

function dismissRejectUseExplanation() {
    const parameters: SetNameValuePairParams = {
        name: ONYXKEYS.NVP_DISMISSED_REJECT_USE_EXPLANATION,
        value: true,
    };

    const optimisticData: Array<OnyxUpdate<typeof ONYXKEYS.NVP_DISMISSED_REJECT_USE_EXPLANATION>> = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: ONYXKEYS.NVP_DISMISSED_REJECT_USE_EXPLANATION,
            value: true,
        },
    ];

    API.write(WRITE_COMMANDS.SET_NAME_VALUE_PAIR, parameters, {
        optimisticData,
    });
}

/**
 * Retrieve the reject money request data
 * @param transactionID - The ID of the transaction to reject
 * @param reportID - The ID of the expense report to reject
 * @param comment - The comment to add to the reject action
 * @param options
 *   - sharedRejectedToReportID: When rejecting multiple expenses sequentially, pass a single shared destination reportID so all rejections land in the same new report.
 * @returns optimisticData, successData, failureData, parameters, urlToNavigateBack
 */
function prepareRejectMoneyRequestData(
    transactionID: string,
    reportID: string,
    comment: string,
    policy: OnyxEntry<OnyxTypes.Policy>,
    currentUserAccountIDParam: number,
    currentUserLogin: string,
    betas: OnyxEntry<OnyxTypes.Beta[]>,
    options?: RejectMoneyRequestOptions,
    shouldUseBulkAction?: boolean,
    // TODO: delegateAccountID will be made required in PR 13 when all callers pass the value (https://github.com/Expensify/App/issues/66425)
    delegateAccountID?: number | undefined,
): RejectMoneyRequestData | undefined {
    const allTransactions = getAllTransactions();
    const allReports = getAllReports();
    // TODO: https://github.com/Expensify/App/issues/66512
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const allTransactionViolations = getAllTransactionViolations();

    const transaction = allTransactions[`${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`];
    const transactionAmount = getAmount(transaction);
    const report = allReports?.[`${ONYXKEYS.COLLECTION.REPORT}${reportID}`];
    const policyExpenseChat = allReports?.[`${ONYXKEYS.COLLECTION.REPORT}${report?.chatReportID}`];
    const isPolicyDelayedSubmissionEnabled = policy ? isDelayedSubmissionEnabled(policy) : false;
    const isIOU = isIOUReport(report);
    const searchFullScreenRoutes = navigationRef.getRootState()?.routes.findLast((route) => route.name === NAVIGATORS.SEARCH_FULLSCREEN_NAVIGATOR);
    const lastRoute = searchFullScreenRoutes?.state?.routes?.at(-1);
    const isUserOnSearchPage = isSearchTopmostFullScreenRoute() && lastRoute?.name === SCREENS.SEARCH.ROOT;
    const isUserOnSearchMoneyRequestReport = isSearchTopmostFullScreenRoute() && lastRoute?.name === SCREENS.SEARCH.MONEY_REQUEST_REPORT;

    if (!report || !transaction) {
        addIssue92246DebugLog('prepareRejectMoneyRequestData missing data', {
            transactionID,
            reportID,
            hasReport: !!report,
            hasTransaction: !!transaction,
        });
        return undefined;
    }

    const reportAction = getIOUActionForReportID(reportID, transactionID);
    const childReportID = reportAction?.childReportID;
    const transactionThreadReport = allReports?.[`${ONYXKEYS.COLLECTION.REPORT}${childReportID}`];

    let movedToReport;
    let rejectedToReportID = options?.sharedRejectedToReportID;
    let urlToNavigateBack;
    let reportPreviewAction: OnyxTypes.ReportAction | undefined;
    let createdIOUReportActionID;
    let expenseMovedReportActionID;
    let expenseCreatedReportActionID;
    let selfDMReportIDForParameters;
    let selfDMReportIDForDebug;
    let selfDMCreatedReportActionID;

    const hasMultipleExpenses = getReportTransactions(reportID).length > 1;
    addIssue92246DebugLog('prepareRejectMoneyRequestData start', {
        transactionID,
        reportID,
        reportType: report.type,
        reportPolicyID: report.policyID,
        reportChatReportID: report.chatReportID,
        childReportID,
        isPolicyDelayedSubmissionEnabled,
        isIOU,
        hasMultipleExpenses,
        shouldUseBulkAction: !!shouldUseBulkAction,
        existingRejectedToReportID: rejectedToReportID,
    });
    const transactionCommentCleanup = (() => {
        if (!transaction?.comment?.dismissedViolations?.[CONST.VIOLATIONS.AUTO_REPORTED_REJECTED_EXPENSE]) {
            return undefined;
        }

        const dismissedViolations = {...(transaction.comment.dismissedViolations ?? {})};
        delete dismissedViolations[CONST.VIOLATIONS.AUTO_REPORTED_REJECTED_EXPENSE];

        return {
            comment: {
                ...(transaction.comment ?? {}),
                dismissedViolations: isEmptyObject(dismissedViolations) ? null : dismissedViolations,
            },
        };
    })();

    // Build optimistic data updates
    const optimisticData: Array<
        OnyxUpdate<
            | typeof ONYXKEYS.COLLECTION.REPORT
            | typeof ONYXKEYS.COLLECTION.TRANSACTION
            | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS
            | typeof ONYXKEYS.COLLECTION.REPORT_METADATA
            | typeof ONYXKEYS.COLLECTION.RAM_ONLY_REPORT_LOADING_STATE
            | typeof ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS
            | typeof ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS
            | typeof ONYXKEYS.SELF_DM_REPORT_ID
        >
    > = [];

    // Create system messages in both expense report and expense thread
    // The "rejected this expense" action should come before the reject comment
    const baseTimestamp = DateUtils.getDBTime();
    const optimisticRejectReportAction = buildOptimisticRejectReportAction(baseTimestamp);
    const parsedComment = getParsedComment(comment);
    const optimisticRejectReportActionComment = buildOptimisticRejectReportActionComment(comment, DateUtils.addMillisecondsFromDateTime(baseTimestamp, 1));
    let movedTransactionAction;

    // Build successData and failureData to prevent duplication
    const successData: Array<
        OnyxUpdate<typeof ONYXKEYS.COLLECTION.REPORT | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS | typeof ONYXKEYS.COLLECTION.REPORT_METADATA | typeof ONYXKEYS.COLLECTION.TRANSACTION>
    > = [];
    const failureData: Array<
        OnyxUpdate<
            | typeof ONYXKEYS.COLLECTION.REPORT
            | typeof ONYXKEYS.COLLECTION.TRANSACTION
            | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS
            | typeof ONYXKEYS.COLLECTION.REPORT_METADATA
            | typeof ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS
            | typeof ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS
        >
    > = [];

    if ((!isPolicyDelayedSubmissionEnabled || isIOU) && !shouldUseBulkAction) {
        if (hasMultipleExpenses) {
            // For reports with multiple expenses: Update report total
            optimisticData.push(
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
                    value: {
                        total: (report?.total ?? 0) + transactionAmount,
                        pendingFields: {
                            total: CONST.RED_BRICK_ROAD_PENDING_ACTION.UPDATE,
                        },
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`,
                    value: {
                        reportID: null,
                        ...(transactionCommentCleanup ?? {}),
                    },
                },
            );

            // Add success data for report total update
            successData.push({
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
                value: {
                    pendingFields: {total: null},
                },
            });

            // Add failure data for report total revert
            failureData.push({
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
                value: {
                    total: report?.total ?? 0,
                    pendingFields: {total: null},
                },
            });

            // Add failure data for transaction revert
            failureData.push({
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`,
                value: {
                    reportID: transaction?.reportID ?? reportID,
                },
            });

            if (isUserOnSearchPage) {
                // Navigate to the existing Reports > Expense view
                urlToNavigateBack = undefined;
            } else {
                // Go back to the original expenses report
                urlToNavigateBack = ROUTES.REPORT_WITH_ID.getRoute(reportID);
            }
        } else {
            // For reports with single expense: Delete the report
            optimisticData.push(
                {
                    onyxMethod: Onyx.METHOD.SET,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
                    value: null,
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`,
                    value: {
                        reportID: CONST.REPORT.UNREPORTED_REPORT_ID,
                        ...(transactionCommentCleanup ?? {}),
                    },
                },
            );

            // And delete the corresponding REPORTPREVIEW action
            const parentReportID = report?.parentReportID;
            const parentReportActionID = report?.parentReportActionID;
            const deletedTime = DateUtils.getDBTime();
            if (parentReportActionID) {
                optimisticData.push({
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${parentReportID}`,
                    value: {
                        [parentReportActionID]: {
                            originalMessage: {
                                deleted: deletedTime,
                            },
                        },
                    },
                });
                failureData.push({
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${parentReportID}`,
                    value: {
                        [parentReportActionID]: {
                            originalMessage: {
                                deleted: null,
                            },
                        },
                    },
                });
            }

            if (!isIOU) {
                const currentTime = DateUtils.getDBTime();
                let selfDMReportID = findSelfDMReportID(allReports);

                if (!selfDMReportID) {
                    const optimisticSelfDMReport = buildOptimisticSelfDMReport(currentTime);
                    selfDMReportID = optimisticSelfDMReport.reportID;
                    const selfDMCreatedReportAction = buildOptimisticCreatedReportAction({emailCreatingAction: currentUserLogin, created: currentTime});
                    selfDMCreatedReportActionID = selfDMCreatedReportAction.reportActionID;

                    optimisticData.push(
                        {
                            onyxMethod: Onyx.METHOD.SET,
                            key: `${ONYXKEYS.COLLECTION.REPORT}${selfDMReportID}`,
                            value: {
                                ...optimisticSelfDMReport,
                                pendingFields: {
                                    createChat: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD,
                                },
                            },
                        },
                        {
                            onyxMethod: Onyx.METHOD.MERGE,
                            key: ONYXKEYS.SELF_DM_REPORT_ID,
                            value: selfDMReportID,
                        },
                        {
                            onyxMethod: Onyx.METHOD.MERGE,
                            key: `${ONYXKEYS.COLLECTION.REPORT_METADATA}${selfDMReportID}`,
                            value: {
                                isOptimisticReport: true,
                            },
                        },
                        {
                            onyxMethod: Onyx.METHOD.SET,
                            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${selfDMReportID}`,
                            value: {
                                [selfDMCreatedReportAction.reportActionID]: selfDMCreatedReportAction,
                            },
                        },
                    );

                    successData.push(
                        {
                            onyxMethod: Onyx.METHOD.MERGE,
                            key: `${ONYXKEYS.COLLECTION.REPORT}${selfDMReportID}`,
                            value: {
                                pendingFields: {
                                    createChat: null,
                                },
                            },
                        },
                        {
                            onyxMethod: Onyx.METHOD.MERGE,
                            key: `${ONYXKEYS.COLLECTION.REPORT_METADATA}${selfDMReportID}`,
                            value: {
                                isOptimisticReport: false,
                            },
                        },
                        {
                            onyxMethod: Onyx.METHOD.MERGE,
                            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${selfDMReportID}`,
                            value: {
                                [selfDMCreatedReportAction.reportActionID]: {
                                    pendingAction: null,
                                },
                            },
                        },
                    );

                    failureData.push(
                        {
                            onyxMethod: Onyx.METHOD.SET,
                            key: `${ONYXKEYS.COLLECTION.REPORT}${selfDMReportID}`,
                            value: null,
                        },
                        {
                            onyxMethod: Onyx.METHOD.MERGE,
                            key: `${ONYXKEYS.COLLECTION.REPORT_METADATA}${selfDMReportID}`,
                            value: null,
                        },
                        {
                            onyxMethod: Onyx.METHOD.MERGE,
                            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${selfDMReportID}`,
                            value: null,
                        },
                    );
                }

                selfDMReportIDForParameters = selfDMReportID;
                selfDMReportIDForDebug = selfDMReportID;

                const selfDMMoneyRequestAction = buildOptimisticIOUReportAction({
                    type: CONST.IOU.REPORT_ACTION_TYPE.TRACK,
                    amount: transactionAmount,
                    currency: getCurrency(transaction),
                    comment: reportAction?.originalMessage?.comment ?? transaction?.comment?.comment ?? '',
                    participants: [{accountID: report.ownerAccountID}],
                    transactionID,
                    iouReportID: selfDMReportID,
                });
                selfDMMoneyRequestAction.childReportID = childReportID;
                if (reportAction) {
                    selfDMMoneyRequestAction.message = reportAction.message;
                    selfDMMoneyRequestAction.originalMessage = {
                        ...reportAction.originalMessage,
                        IOUTransactionID: transactionID,
                        type: CONST.IOU.REPORT_ACTION_TYPE.TRACK,
                    };
                }

                createdIOUReportActionID = selfDMMoneyRequestAction.reportActionID;

                const unreportedAction = buildOptimisticUnreportedTransactionAction(childReportID, reportID);
                expenseMovedReportActionID = unreportedAction.reportActionID;

                optimisticData.push(
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${selfDMReportID}`,
                        value: {
                            [selfDMMoneyRequestAction.reportActionID]: selfDMMoneyRequestAction,
                        },
                    },
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: `${ONYXKEYS.COLLECTION.REPORT}${childReportID}`,
                        value: {
                            parentReportActionID: selfDMMoneyRequestAction.reportActionID,
                            parentReportID: selfDMReportID,
                            chatReportID: selfDMReportID,
                            policyID: CONST.POLICY.ID_FAKE,
                        },
                    },
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${childReportID}`,
                        value: {
                            [unreportedAction.reportActionID]: unreportedAction,
                        },
                    },
                );

                successData.push(
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${selfDMReportID}`,
                        value: {
                            [selfDMMoneyRequestAction.reportActionID]: null,
                        },
                    },
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${childReportID}`,
                        value: {
                            [unreportedAction.reportActionID]: {
                                pendingAction: null,
                            },
                        },
                    },
                );

                failureData.push(
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${selfDMReportID}`,
                        value: {
                            [selfDMMoneyRequestAction.reportActionID]: null,
                        },
                    },
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: `${ONYXKEYS.COLLECTION.REPORT}${childReportID}`,
                        value: {
                            parentReportActionID: transactionThreadReport?.parentReportActionID,
                            parentReportID: transactionThreadReport?.parentReportID,
                            chatReportID: transactionThreadReport?.chatReportID,
                            policyID: transactionThreadReport?.policyID,
                        },
                    },
                    {
                        onyxMethod: Onyx.METHOD.MERGE,
                        key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${childReportID}`,
                        value: {
                            [unreportedAction.reportActionID]: null,
                        },
                    },
                );

                addIssue92246DebugLog('single expense rejected to selfDM', {
                    transactionID,
                    sourceReportID: reportID,
                    sourceChatReportID: report.chatReportID,
                    selfDMReportID,
                    didCreateSelfDM: !!selfDMCreatedReportActionID,
                    selfDMCreatedReportActionID,
                    createdIOUReportActionID,
                    expenseMovedReportActionID,
                    childReportID,
                    previousThreadParentReportID: transactionThreadReport?.parentReportID,
                    previousThreadParentReportActionID: transactionThreadReport?.parentReportActionID,
                    nextThreadParentReportID: selfDMReportID,
                    nextThreadParentReportActionID: selfDMMoneyRequestAction.reportActionID,
                });
            }

            // Add success data for report deletion (no action needed, report is already deleted)
            successData.push({
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
                value: null,
            });

            // Add failure data to restore the report
            failureData.push(
                {
                    onyxMethod: Onyx.METHOD.SET,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
                    value: report,
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`,
                    value: {
                        reportID,
                    },
                },
            );

            if (isUserOnSearchPage) {
                // Navigate to the existing Reports > Expense view.
                urlToNavigateBack = undefined;
            } else if (isUserOnSearchMoneyRequestReport) {
                // Go back based on backTo param of the current route
                const lastRouteParams = lastRoute?.params;
                urlToNavigateBack = lastRouteParams && 'backTo' in lastRouteParams ? lastRouteParams?.backTo : undefined;
            } else {
                // Go back to the destination chat. For a single expense rejected from a manually submitted report,
                // this is the selfDM where the expense becomes unreported again.
                urlToNavigateBack = ROUTES.REPORT_WITH_ID.getRoute(selfDMReportIDForDebug ?? report.chatReportID);
            }
        }
    } else if (hasMultipleExpenses && !shouldUseBulkAction) {
        if (isUserOnSearchPage || isUserOnSearchMoneyRequestReport) {
            // Navigate to the existing Reports > Expense view.
            urlToNavigateBack = undefined;
        } else {
            // Go back to the original expenses report
            urlToNavigateBack = ROUTES.REPORT_WITH_ID.getRoute(reportID);
        }
        // For reports with multiple expenses:
        // 1. Update report total
        // 2. Remove expense from report
        // 3. Add to existing draft report or create new one
        const existingOpenReport =
            options?.existingRejectedReport ??
            Object.values(allReports ?? {}).find(
                (r) =>
                    r?.reportID !== reportID &&
                    r?.chatReportID === report.chatReportID &&
                    r?.type === CONST.REPORT.TYPE.EXPENSE &&
                    isOpenReport(r) &&
                    r?.ownerAccountID === report.ownerAccountID,
            );

        if (existingOpenReport) {
            const originalRejectedReportTotal = existingOpenReport?.total ?? 0;
            movedToReport = {
                ...existingOpenReport,
                total: originalRejectedReportTotal - transactionAmount,
            };
            options?.setExistingRejectedReport?.(movedToReport);
            rejectedToReportID = existingOpenReport.reportID;

            const [, , iouAction] = buildOptimisticMoneyRequestEntities({
                iouReport: movedToReport,
                type: CONST.IOU.REPORT_ACTION_TYPE.CREATE,
                amount: transactionAmount,
                currency: getCurrency(transaction),
                comment: parsedComment,
                payeeEmail: getLoginByAccountID(report.ownerAccountID ?? CONST.DEFAULT_NUMBER_ID) ?? '',
                participants: [{accountID: report?.ownerAccountID}],
                transactionID: transaction.transactionID,
                existingTransactionThreadReportID: childReportID,
                shouldGenerateTransactionThreadReport: false,
                currentUserAccountID: currentUserAccountIDParam,
                delegateAccountIDParam: delegateAccountID,
            });
            createdIOUReportActionID = iouAction.reportActionID;

            optimisticData.push(
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${movedToReport?.reportID}`,
                    value: {
                        ...movedToReport,
                        total: (movedToReport?.total ?? 0) - transactionAmount,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${rejectedToReportID}`,
                    value: {[iouAction.reportActionID]: iouAction},
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${childReportID}`,
                    value: {
                        parentReportActionID: iouAction.reportActionID,
                        parentReportID: rejectedToReportID,
                    },
                },
            );

            // Add success data for existing report update
            successData.push(
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${movedToReport?.reportID}`,
                    value: {pendingFields: {total: null}},
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${rejectedToReportID}`,
                    value: {[iouAction.reportActionID]: {pendingAction: null}},
                },
            );

            failureData.push(
                // Add failure data to revert existing report total
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${movedToReport?.reportID}`,
                    value: {
                        total: originalRejectedReportTotal,
                        pendingFields: {total: null},
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${childReportID}`,
                    value: {
                        parentReportActionID: transactionThreadReport?.parentReportActionID,
                        parentReportID: transactionThreadReport?.parentReportID,
                    },
                },
            );
        } else {
            // When no existing open report is found, use the sharedRejectedToReportID
            // so multiple sequential rejections land in the same destination report
            // Fallback to generating a fresh ID if not provided
            rejectedToReportID = rejectedToReportID ?? generateReportID();

            // Pass transaction for formula computation (e.g., {report:startdate})
            const reportTransactions: Record<string, OnyxTypes.Transaction> = {[transaction.transactionID]: transaction};

            const newExpenseReport = buildOptimisticExpenseReport({
                chatReportID: report.chatReportID,
                policyID: report?.policyID,
                payeeAccountID: report?.ownerAccountID ?? CONST.DEFAULT_NUMBER_ID,
                total: transactionAmount,
                currency: getCurrency(transaction),
                nonReimbursableTotal: transactionAmount,
                optimisticIOUReportID: rejectedToReportID,
                reportTransactions,
                betas,
            });
            const [, createdActionForExpenseReport, iouAction] = buildOptimisticMoneyRequestEntities({
                iouReport: newExpenseReport,
                type: CONST.IOU.REPORT_ACTION_TYPE.CREATE,
                amount: transactionAmount,
                currency: getCurrency(transaction),
                comment: parsedComment,
                payeeEmail: currentUserLogin,
                participants: [{accountID: report?.ownerAccountID}],
                transactionID: transaction.transactionID,
                existingTransactionThreadReportID: childReportID,
                shouldGenerateTransactionThreadReport: false,
                currentUserAccountID: currentUserAccountIDParam,
                delegateAccountIDParam: delegateAccountID,
            });

            reportPreviewAction = buildOptimisticReportPreview(policyExpenseChat, newExpenseReport, undefined, transaction, undefined, undefined, delegateAccountID);
            movedTransactionAction = buildOptimisticMovedTransactionAction(childReportID, newExpenseReport.reportID);
            createdIOUReportActionID = iouAction.reportActionID;
            expenseMovedReportActionID = movedTransactionAction.reportActionID;
            expenseCreatedReportActionID = createdActionForExpenseReport.reportActionID;
            newExpenseReport.parentReportActionID = reportPreviewAction.reportActionID;
            options?.setExistingRejectedReport?.(newExpenseReport);
            optimisticData.push(
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${policyExpenseChat?.reportID}`,
                    value: {
                        lastVisibleActionCreated: reportPreviewAction.created,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.SET,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${rejectedToReportID}`,
                    value: {
                        ...newExpenseReport,
                        pendingFields: {createReport: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD},
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.SET,
                    key: `${ONYXKEYS.COLLECTION.REPORT_METADATA}${rejectedToReportID}`,
                    value: {
                        isOptimisticReport: true,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.SET,
                    key: `${ONYXKEYS.COLLECTION.RAM_ONLY_REPORT_LOADING_STATE}${rejectedToReportID}`,
                    value: {
                        hasOnceLoadedReportActions: true,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${rejectedToReportID}`,
                    value: {[createdActionForExpenseReport.reportActionID]: createdActionForExpenseReport, [iouAction.reportActionID]: iouAction},
                },
                {
                    onyxMethod: Onyx.METHOD.SET,
                    key: `${ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS}${rejectedToReportID}`,
                    value: {
                        parentReportID: report?.chatReportID,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${policyExpenseChat?.reportID}`,
                    value: {
                        [reportPreviewAction.reportActionID]: reportPreviewAction,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${childReportID}`,
                    value: {
                        parentReportActionID: iouAction.reportActionID,
                        parentReportID: rejectedToReportID,
                    },
                },
            );
            successData.push(
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${rejectedToReportID}`,
                    value: {
                        pendingFields: null,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_METADATA}${rejectedToReportID}`,
                    value: {
                        isOptimisticReport: null,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${rejectedToReportID}`,
                    value: {[createdActionForExpenseReport.reportActionID]: {pendingAction: null}, [iouAction.reportActionID]: {pendingAction: null}},
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${policyExpenseChat?.reportID}`,
                    value: {
                        [reportPreviewAction.reportActionID]: {pendingAction: null},
                    },
                },
            );

            failureData.push(
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${policyExpenseChat?.reportID}`,
                    value: {
                        lastVisibleActionCreated: policyExpenseChat?.lastVisibleActionCreated,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.SET,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${rejectedToReportID}`,
                    value: null,
                },
                {
                    onyxMethod: Onyx.METHOD.SET,
                    key: `${ONYXKEYS.COLLECTION.REPORT_METADATA}${rejectedToReportID}`,
                    value: null,
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${rejectedToReportID}`,
                    value: null,
                },
                {
                    onyxMethod: Onyx.METHOD.SET,
                    key: `${ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS}${rejectedToReportID}`,
                    value: null,
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${policyExpenseChat?.reportID}`,
                    value: {
                        [reportPreviewAction.reportActionID]: null,
                    },
                },
                {
                    onyxMethod: Onyx.METHOD.MERGE,
                    key: `${ONYXKEYS.COLLECTION.REPORT}${childReportID}`,
                    value: {
                        parentReportActionID: transactionThreadReport?.parentReportActionID,
                        parentReportID: transactionThreadReport?.parentReportID,
                    },
                },
            );
        }
        optimisticData.push(
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
                value: {
                    total: (report?.total ?? 0) + transactionAmount,
                },
            },
            {
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`,
                value: {
                    reportID: rejectedToReportID,
                    ...(transactionCommentCleanup ?? {}),
                },
            },
        );

        // Add success data for original report total update
        successData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
            value: {
                pendingFields: null,
                errorFields: null,
            },
        });

        // Add success data for transaction update
        successData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`,
            value: {
                pendingAction: null,
                errorFields: null,
            },
        });

        // Add failure data to revert original report total
        failureData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
            value: {
                total: report?.total ?? 0,
            },
        });

        // Add failure data to revert transaction reportID
        failureData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`,
            value: {
                reportID: transaction?.reportID ?? reportID,
            },
        });
    } else {
        // For reports with single expense
        optimisticData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
            value: {
                stateNum: CONST.REPORT.STATE_NUM.OPEN,
                statusNum: CONST.REPORT.STATUS_NUM.OPEN,
            },
        });

        optimisticData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.TRANSACTION}${transactionID}`,
            value: {
                ...(transactionCommentCleanup ?? {}),
            },
        });

        // Add success data for report state update
        successData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
            value: {
                pendingFields: {
                    stateNum: null,
                    statusNum: null,
                },
            },
        });

        // Add failure data to revert report state
        failureData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
            value: {
                stateNum: report?.stateNum,
                statusNum: report?.statusNum,
            },
        });

        if (isUserOnSearchPage || isUserOnSearchMoneyRequestReport) {
            // Navigate to the existing Reports > Expense view
            urlToNavigateBack = undefined;
        } else {
            // Go back to the original expenses report
            urlToNavigateBack = ROUTES.REPORT_WITH_ID.getRoute(reportID);
        }
    }

    // Add optimistic rejected actions to the child report
    optimisticData.push({
        onyxMethod: Onyx.METHOD.MERGE,
        key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${childReportID}`,
        value: {
            [optimisticRejectReportAction.reportActionID]: optimisticRejectReportAction,
            [optimisticRejectReportActionComment.reportActionID]: optimisticRejectReportActionComment,
            ...(movedTransactionAction ? {[movedTransactionAction.reportActionID]: movedTransactionAction} : {}),
        },
    });

    // Update hasOutstandingChildRequest on the chat report after all optimistic updates
    if (policyExpenseChat) {
        const excludedReportID = hasMultipleExpenses ? (rejectedToReportID ?? reportID) : reportID;
        const shouldHaveOutstandingChildRequest = hasOutstandingChildRequest(
            policyExpenseChat,
            excludedReportID,
            currentUserLogin,
            currentUserAccountIDParam,
            allTransactionViolations,
            undefined,
        );

        if (policyExpenseChat.hasOutstandingChildRequest !== shouldHaveOutstandingChildRequest) {
            optimisticData.push({
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT}${policyExpenseChat.reportID}`,
                value: {
                    hasOutstandingChildRequest: shouldHaveOutstandingChildRequest,
                },
            });

            failureData.push({
                onyxMethod: Onyx.METHOD.MERGE,
                key: `${ONYXKEYS.COLLECTION.REPORT}${policyExpenseChat.reportID}`,
                value: {
                    hasOutstandingChildRequest: policyExpenseChat.hasOutstandingChildRequest,
                },
            });
        }
    }

    // Add successData to clear pending actions when the server confirms
    successData.push({
        onyxMethod: Onyx.METHOD.MERGE,
        key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${childReportID}`,
        value: {
            [optimisticRejectReportAction.reportActionID]: {
                pendingAction: null,
            },
            [optimisticRejectReportActionComment.reportActionID]: {
                pendingAction: null,
            },
        },
    });

    // Add failureData to remove optimistic actions if the request fails
    failureData.push({
        onyxMethod: Onyx.METHOD.MERGE,
        key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${childReportID}`,
        value: {
            [optimisticRejectReportAction.reportActionID]: null,
            [optimisticRejectReportActionComment.reportActionID]: null,
        },
    });

    // Collect all reports that need lastReadTime and lastVisibleActionCreated updates
    const reportsToUpdate: Array<{reportID: string; lastVisibleActionCreated: string}> = [];

    // Add rter transaction violation
    if (!isIOU) {
        const currentTransactionViolations = allTransactionViolations?.[`${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transaction?.transactionID}`] ?? [];
        const newViolation = {
            name: CONST.VIOLATIONS.AUTO_REPORTED_REJECTED_EXPENSE,
            type: CONST.VIOLATION_TYPES.WARNING,
            data: {
                comment: comment ?? '',
                rejectedBy: currentUserLogin,
                rejectedDate: DateUtils.getDBTime(),
            },
            showInReview: true,
        };

        optimisticData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transaction?.transactionID}`,
            value: [...currentTransactionViolations, newViolation],
        });

        // Add failure data to revert transaction violations
        failureData.push({
            onyxMethod: Onyx.METHOD.SET,
            key: `${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transaction?.transactionID}`,
            value: currentTransactionViolations,
        });
    }

    // Child report (where rejected actions are added)
    if (childReportID) {
        reportsToUpdate.push({
            reportID: childReportID,
            lastVisibleActionCreated: optimisticRejectReportActionComment.created,
        });
    }

    // Moved to report (if transaction is moved to another report)
    if (rejectedToReportID && rejectedToReportID !== reportID) {
        reportsToUpdate.push({
            reportID: rejectedToReportID,
            lastVisibleActionCreated: optimisticRejectReportActionComment.created,
        });
    }
    if (selfDMReportIDForDebug) {
        reportsToUpdate.push({
            reportID: selfDMReportIDForDebug,
            lastVisibleActionCreated: optimisticRejectReportActionComment.created,
        });
    }

    const lastReadTime = DateUtils.subtractMillisecondsFromDateTime(optimisticRejectReportAction.created, 1);
    // Add optimistic data for all reports
    for (const {reportID: targetReportID, lastVisibleActionCreated} of reportsToUpdate) {
        optimisticData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${targetReportID}`,
            value: {
                lastReadTime,
                lastVisibleActionCreated,
            },
        });
    }

    // Add success data for all reports
    for (const {reportID: targetReportID} of reportsToUpdate) {
        successData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${targetReportID}`,
            value: {
                pendingFields: null,
                errorFields: null,
            },
        });
    }

    // Add failure data to revert all reports
    for (const {reportID: targetReportID} of reportsToUpdate) {
        const targetReport = allReports?.[`${ONYXKEYS.COLLECTION.REPORT}${targetReportID}`];
        failureData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${targetReportID}`,
            value: {
                lastReadTime: targetReport?.lastReadTime,
                lastVisibleActionCreated: targetReport?.lastVisibleActionCreated,
            },
        });
    }

    // Build API parameters
    const parameters: RejectMoneyRequestParams = {
        transactionID,
        reportID,
        comment: parsedComment,
        rejectedToReportID,
        reportPreviewReportActionID: reportPreviewAction?.reportActionID,
        rejectedActionReportActionID: optimisticRejectReportAction.reportActionID,
        rejectedCommentReportActionID: optimisticRejectReportActionComment.reportActionID,
        createdIOUReportActionID,
        expenseMovedReportActionID,
        expenseCreatedReportActionID,
        selfDMReportID: selfDMReportIDForParameters,
        selfDMCreatedReportActionID,
    };

    const debugContext: Issue92246DebugContext = {
        transactionID,
        sourceReportID: reportID,
        sourceChatReportID: report.chatReportID,
        childReportID,
        rejectedToReportID,
        selfDMReportID: selfDMReportIDForDebug,
        rejectedActionReportActionID: optimisticRejectReportAction.reportActionID,
        rejectedCommentReportActionID: optimisticRejectReportActionComment.reportActionID,
        reportPreviewReportActionID: reportPreviewAction?.reportActionID,
        createdIOUReportActionID,
        expenseMovedReportActionID,
        expenseCreatedReportActionID,
        selfDMCreatedReportActionID,
        urlToNavigateBack: urlToNavigateBack as Route,
    };

    addIssue92246DebugLog('prepareRejectMoneyRequestData parameters', parameters);
    addIssue92246StateSnapshotLog('prepareRejectMoneyRequestData before API.write state', debugContext, {
        parameters,
        urlToNavigateBack,
        optimisticData: summarizeOnyxUpdates(optimisticData, debugContext),
        successData: summarizeOnyxUpdates(successData, debugContext),
        failureData: summarizeOnyxUpdates(failureData, debugContext),
    });

    return {optimisticData, successData, failureData, parameters, urlToNavigateBack: urlToNavigateBack as Route, debugContext};
}

function rejectMoneyRequest(
    transactionID: string,
    reportID: string,
    comment: string,
    policy: OnyxEntry<OnyxTypes.Policy>,
    currentUserAccountIDParam: number,
    currentUserLogin: string,
    betas: OnyxEntry<OnyxTypes.Beta[]>,
    options?: RejectMoneyRequestOptions,
): Route | undefined {
    const data = prepareRejectMoneyRequestData(transactionID, reportID, comment, policy, currentUserAccountIDParam, currentUserLogin, betas, options);
    if (!data) {
        return;
    }
    const {urlToNavigateBack, optimisticData, successData, failureData, parameters, debugContext} = data;
    addIssue92246DebugLog('rejectMoneyRequest API.write prepared', {
        command: WRITE_COMMANDS.REJECT_MONEY_REQUEST,
        parameters,
        urlToNavigateBack,
        optimisticKeys: optimisticData.map((update) => update.key),
        successKeys: successData.map((update) => update.key),
        failureKeys: failureData.map((update) => update.key),
        navigationBeforeWrite: getNavigationDebugState(),
    });
    // Make API call
    API.write(WRITE_COMMANDS.REJECT_MONEY_REQUEST, parameters, {optimisticData, successData, failureData});
    scheduleIssue92246SettledStateSnapshots(debugContext);

    return urlToNavigateBack;
}

function markRejectViolationAsResolved(transactionID: string, isOffline: boolean, reportID?: string) {
    if (!reportID) {
        return;
    }

    // TODO: https://github.com/Expensify/App/issues/66512
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const allTransactionViolations = getAllTransactionViolations();

    const currentViolations = allTransactionViolations?.[`${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transactionID}`];
    const updatedViolations = currentViolations?.filter((violation) => violation.name !== CONST.VIOLATIONS.AUTO_REPORTED_REJECTED_EXPENSE);
    const optimisticMarkedAsResolvedReportAction = buildOptimisticMarkedAsResolvedReportAction();

    // Build optimistic data
    const optimisticData: Array<OnyxUpdate<typeof ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS>> = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transactionID}`,
            value: updatedViolations ?? null,
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`,
            value: {
                [optimisticMarkedAsResolvedReportAction.reportActionID]: optimisticMarkedAsResolvedReportAction,
            },
        },
    ];

    const successData: Array<OnyxUpdate<typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS>> = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`,
            value: {
                [optimisticMarkedAsResolvedReportAction.reportActionID]: {
                    pendingAction: null,
                },
            },
        },
    ];

    const failureData: Array<OnyxUpdate<typeof ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS>> = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transactionID}`,
            value: currentViolations ?? null,
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`,
            value: {
                [optimisticMarkedAsResolvedReportAction.reportActionID]: null,
            },
        },
    ];

    const parameters: MarkTransactionViolationAsResolvedParams = {
        transactionID,
        markedAsResolvedReportActionID: optimisticMarkedAsResolvedReportAction.reportActionID,
    };

    // Make API call
    API.write(WRITE_COMMANDS.MARK_TRANSACTION_VIOLATION_AS_RESOLVED, parameters, {
        optimisticData,
        successData,
        failureData,
    });

    const currentReportID = getDisplayedReportID(reportID, isOffline);
    notifyNewAction(currentReportID, undefined, true);
}

function rejectExpenseReport(
    report: OnyxTypes.Report,
    targetAccountID: number,
    comment: string,
    currentUserAccountID: number | undefined,
    currentUserDisplayName: string | undefined,
    currentUserAvatarSource: AvatarSource | undefined,
    policy?: OnyxEntry<OnyxTypes.Policy>,
    currentUserLogin = '',
    betas?: OnyxEntry<OnyxTypes.Beta[]>,
) {
    const {reportID} = report;
    const isRejectToSubmitter = targetAccountID === report.ownerAccountID;
    const transactions = getReportTransactions(reportID);
    const transactionID = transactions.at(0)?.transactionID;

    addIssue92246DebugLog('rejectExpenseReport start', {
        reportID,
        report: summarizeReport(report),
        targetAccountID,
        ownerAccountID: report.ownerAccountID,
        policyID: policy?.id ?? report.policyID,
        hasPolicy: !!policy,
        isDelayedSubmissionEnabled: policy ? isDelayedSubmissionEnabled(policy) : undefined,
        isRejectToSubmitter,
        transactionCount: transactions.length,
        firstTransactionID: transactionID,
        snapshot: buildIssue92246OnyxSnapshot({
            sourceReportID: reportID,
            sourceChatReportID: report.chatReportID,
            transactionID,
        }),
    });

    if (isRejectToSubmitter && policy && !isDelayedSubmissionEnabled(policy)) {
        if (transactions.length === 1 && transactionID) {
            addIssue92246DebugLog('rejectExpenseReport routed to rejectMoneyRequest', {
                reportID,
                transactionID,
                targetAccountID,
                policyID: policy.id,
            });
            const urlToNavigateBack = rejectMoneyRequest(
                transactionID,
                reportID,
                comment,
                policy,
                currentUserAccountID ?? CONST.DEFAULT_NUMBER_ID,
                currentUserLogin || getLoginByAccountID(currentUserAccountID ?? CONST.DEFAULT_NUMBER_ID) || '',
                betas,
            );
            addIssue92246DebugLog('rejectExpenseReport money-request path returned navigation target', {
                reportID,
                transactionID,
                urlToNavigateBack,
                note: 'RejectExpenseReportPage uses this route as the Navigation.goBack target when present.',
            });
            return urlToNavigateBack;
        }

        addIssue92246DebugLog('rejectExpenseReport kept report-level path because transaction routing was not eligible', {
            reportID,
            targetAccountID,
            policyID: policy.id,
            transactionCount: transactions.length,
            firstTransactionID: transactionID,
        });
    }

    addIssue92246DebugLog('rejectExpenseReport using report-level API', {
        reportID,
        targetAccountID,
        isRejectToSubmitter,
    });

    const baseTimestamp = DateUtils.getDBTime();
    const optimisticRejectAction = buildOptimisticReportLevelRejectAction(isRejectToSubmitter, currentUserAccountID, currentUserDisplayName, currentUserAvatarSource, baseTimestamp);
    const parsedComment = getParsedComment(comment);
    const optimisticCommentAction = buildOptimisticReportLevelRejectCommentAction(
        parsedComment,
        currentUserAccountID,
        currentUserDisplayName,
        currentUserAvatarSource,
        DateUtils.addMillisecondsFromDateTime(baseTimestamp, 1),
    );

    const optimisticStateNum = isRejectToSubmitter ? CONST.REPORT.STATE_NUM.OPEN : CONST.REPORT.STATE_NUM.SUBMITTED;
    const optimisticStatusNum = isRejectToSubmitter ? CONST.REPORT.STATUS_NUM.OPEN : CONST.REPORT.STATUS_NUM.SUBMITTED;

    const optimisticNextStep = isRejectToSubmitter
        ? buildOptimisticNextStep({
              report,
              predictedNextStatus: CONST.REPORT.STATUS_NUM.OPEN,
              isRejectedReport: true,
          })
        : buildOptimisticNextStep({
              report,
              predictedNextStatus: CONST.REPORT.STATUS_NUM.SUBMITTED,
              bypassNextApproverID: targetAccountID,
          });

    const optimisticData: Array<OnyxUpdate<typeof ONYXKEYS.COLLECTION.REPORT | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS | typeof ONYXKEYS.COLLECTION.NEXT_STEP>> = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
            value: {
                managerID: targetAccountID,
                stateNum: optimisticStateNum,
                statusNum: optimisticStatusNum,
                pendingFields: {
                    partial: CONST.RED_BRICK_ROAD_PENDING_ACTION.UPDATE,
                    nextStep: CONST.RED_BRICK_ROAD_PENDING_ACTION.UPDATE,
                },
                nextStep: optimisticNextStep,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`,
            value: {
                [optimisticRejectAction.reportActionID]: {
                    ...(optimisticRejectAction as OnyxTypes.ReportAction),
                    pendingAction: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD,
                },
                [optimisticCommentAction.reportActionID]: {
                    ...(optimisticCommentAction as OnyxTypes.ReportAction),
                    pendingAction: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD,
                },
            },
        },
    ];

    optimisticData.push({
        onyxMethod: Onyx.METHOD.MERGE,
        key: `${ONYXKEYS.COLLECTION.NEXT_STEP}${reportID}`,
        value: isRejectToSubmitter
            ? // buildOptimisticNextStep is used in parallel
              buildNextStepNew({
                  report,
                  predictedNextStatus: CONST.REPORT.STATUS_NUM.OPEN,
                  isRejectedReport: true,
              })
            : // buildOptimisticNextStep is used in parallel
              buildNextStepNew({
                  report,
                  predictedNextStatus: CONST.REPORT.STATUS_NUM.SUBMITTED,
                  bypassNextApproverID: targetAccountID,
              }),
    });

    if (report.parentReportID && report.parentReportActionID) {
        optimisticData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.parentReportID}`,
            value: {
                [report.parentReportActionID]: {
                    childStateNum: optimisticStateNum,
                    childStatusNum: optimisticStatusNum,
                },
            },
        });
    }

    const successData: Array<OnyxUpdate<typeof ONYXKEYS.COLLECTION.REPORT | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS>> = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
            value: {
                pendingFields: {
                    partial: null,
                    nextStep: null,
                },
                errorFields: {
                    partial: null,
                },
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`,
            value: {
                [optimisticRejectAction.reportActionID]: {
                    pendingAction: null,
                },
                [optimisticCommentAction.reportActionID]: {
                    pendingAction: null,
                },
            },
        },
    ];

    const failureData: Array<OnyxUpdate<typeof ONYXKEYS.COLLECTION.REPORT | typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS | typeof ONYXKEYS.COLLECTION.NEXT_STEP>> = [
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT}${reportID}`,
            value: {
                managerID: report.managerID,
                stateNum: report.stateNum,
                statusNum: report.statusNum,
                pendingFields: {
                    partial: null,
                    nextStep: null,
                },
                errorFields: {
                    partial: getMicroSecondOnyxErrorWithTranslationKey('iou.rejectReport.couldNotReject'),
                },
                nextStep: report.nextStep ?? null,
            },
        },
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${reportID}`,
            value: {
                [optimisticCommentAction.reportActionID]: {
                    ...(optimisticCommentAction as OnyxTypes.ReportAction),
                    pendingAction: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD,
                    errors: getMicroSecondOnyxErrorWithTranslationKey('iou.rejectReport.couldNotReject'),
                },
            },
        },
    ];

    failureData.push({
        onyxMethod: Onyx.METHOD.MERGE,
        key: `${ONYXKEYS.COLLECTION.NEXT_STEP}${reportID}`,
        value: null,
    });

    if (report.parentReportID && report.parentReportActionID) {
        failureData.push({
            onyxMethod: Onyx.METHOD.MERGE,
            key: `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${report.parentReportID}`,
            value: {
                [report.parentReportActionID]: {
                    childStateNum: report.stateNum,
                    childStatusNum: report.statusNum,
                },
            },
        });
    }

    const parameters: RejectExpenseReportParams = {
        reportID,
        targetAccountID,
        comment: parsedComment,
        rejectedActionReportActionID: optimisticRejectAction.reportActionID,
        rejectedCommentReportActionID: optimisticCommentAction.reportActionID,
    };

    API.write(WRITE_COMMANDS.REJECT_EXPENSE_REPORT, parameters, {optimisticData, successData, failureData});
}

export {dismissRejectUseExplanation, prepareRejectMoneyRequestData, rejectMoneyRequest, markRejectViolationAsResolved, rejectExpenseReport};
export type {RejectMoneyRequestData};
