/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import Onyx from 'react-native-onyx';
import type {OnyxCollection, OnyxEntry} from 'react-native-onyx';
import {markRejectViolationAsResolved, rejectExpenseReport, rejectMoneyRequest} from '@libs/actions/IOU/RejectMoneyRequest';
import initOnyxDerivedValues from '@libs/actions/OnyxDerived';
import {WRITE_COMMANDS} from '@libs/API/types';
import {getParsedComment} from '@libs/ReportUtils';
import CONST from '@src/CONST';
import OnyxUpdateManager from '@src/libs/actions/OnyxUpdateManager';
import * as API from '@src/libs/API';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import type {Policy, Report, ReportAction} from '@src/types/onyx';
import type Transaction from '@src/types/onyx/Transaction';
import createRandomPolicy from '../../utils/collections/policies';
import {createRandomReport} from '../../utils/collections/reports';
import createRandomTransaction from '../../utils/collections/transaction';
import getOnyxValue from '../../utils/getOnyxValue';
import type {MockFetch} from '../../utils/TestHelper';
import {getGlobalFetchMock, getOnyxData} from '../../utils/TestHelper';
import waitForBatchedUpdates from '../../utils/waitForBatchedUpdates';

jest.mock('@src/libs/Navigation/Navigation', () => ({
    navigate: jest.fn(),
    dismissModal: jest.fn(),
    dismissModalWithReport: jest.fn(),
    goBack: jest.fn(),
    getTopmostReportId: jest.fn(() => '23423423'),
    setNavigationActionToMicrotaskQueue: jest.fn(),
    removeScreenByKey: jest.fn(),
    isNavigationReady: jest.fn(() => Promise.resolve()),
    getReportRouteByID: jest.fn(),
    getActiveRouteWithoutParams: jest.fn(),
    getActiveRoute: jest.fn(),
    navigationRef: {
        getRootState: jest.fn(),
    },
}));

jest.mock('@react-navigation/native');

jest.mock('@src/libs/actions/Report', () => {
    const originalModule = jest.requireActual('@src/libs/actions/Report');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
        ...originalModule,
        notifyNewAction: jest.fn(),
    };
});

jest.mock('@libs/Navigation/helpers/isSearchTopmostFullScreenRoute', () => jest.fn());

const RORY_EMAIL = 'rory@expensifail.com';
const RORY_ACCOUNT_ID = 3;

OnyxUpdateManager();

describe('actions/IOU/RejectMoneyRequest', () => {
    let mockFetch: MockFetch;

    beforeAll(() => {
        Onyx.init({
            keys: ONYXKEYS,
            initialKeyStates: {
                [ONYXKEYS.SESSION]: {accountID: RORY_ACCOUNT_ID, email: RORY_EMAIL},
                [ONYXKEYS.PERSONAL_DETAILS_LIST]: {[RORY_ACCOUNT_ID]: {accountID: RORY_ACCOUNT_ID, login: RORY_EMAIL}},
            },
        });
        initOnyxDerivedValues();
    });

    beforeEach(() => {
        global.fetch = getGlobalFetchMock();
        mockFetch = fetch as MockFetch;
        return Onyx.clear().then(waitForBatchedUpdates);
    });

    afterEach(() => {
        mockFetch?.mockClear();
    });

    describe('rejectMoneyRequest', () => {
        const amount = 10000;
        const comment = 'This expense is rejected';
        let chatReport: OnyxEntry<Report>;
        let iouReport: OnyxEntry<Report>;
        let transaction: OnyxEntry<Transaction>;
        let policy: OnyxEntry<Policy>;
        const TEST_USER_ACCOUNT_ID = 1;
        const TEST_USER_EMAIL = 'test@email.com';
        const MANAGER_ACCOUNT_ID = 2;
        const ADMIN_ACCOUNT_ID = 3;
        const SELF_DM_REPORT_ID = 'selfDMReport';
        const TRANSACTION_THREAD_REPORT_ID = 'transactionThreadReport';
        const MONEY_REQUEST_REPORT_ACTION_ID = 'moneyRequestAction';

        beforeEach(async () => {
            // Set up test data
            policy = createRandomPolicy(1);
            policy.role = CONST.POLICY.ROLE.ADMIN;
            policy.autoReporting = true;
            policy.autoReportingFrequency = CONST.POLICY.AUTO_REPORTING_FREQUENCIES.WEEKLY;

            chatReport = {
                ...createRandomReport(1, CONST.REPORT.CHAT_TYPE.POLICY_EXPENSE_CHAT),
                policyID: policy?.id,
                type: CONST.REPORT.TYPE.CHAT,
            };

            iouReport = {
                ...createRandomReport(2, undefined),
                type: CONST.REPORT.TYPE.IOU,
                ownerAccountID: TEST_USER_ACCOUNT_ID,
                managerID: MANAGER_ACCOUNT_ID,
                total: amount,
                currency: CONST.CURRENCY.USD,
                stateNum: CONST.REPORT.STATE_NUM.SUBMITTED,
                statusNum: CONST.REPORT.STATUS_NUM.SUBMITTED,
                policyID: policy?.id,
                chatReportID: chatReport?.reportID,
            };

            transaction = {
                ...createRandomTransaction(1),
                reportID: iouReport?.reportID,
                amount,
                currency: CONST.CURRENCY.USD,
                merchant: 'Test Merchant',
                transactionID: '1',
            };

            await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${policy?.id}`, policy);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${chatReport?.reportID}`, chatReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${iouReport?.reportID}`, iouReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${transaction?.transactionID}`, transaction);
            await Onyx.set(ONYXKEYS.SESSION, {accountID: ADMIN_ACCOUNT_ID});
            await waitForBatchedUpdates();
        });

        const seedSelfDMAndMoneyRequestThread = async (expenseReport: Report, expenseTransaction: Transaction) => {
            const selfDMReport: Report = {
                ...createRandomReport(99, CONST.REPORT.CHAT_TYPE.SELF_DM),
                reportID: SELF_DM_REPORT_ID,
                type: CONST.REPORT.TYPE.CHAT,
                ownerAccountID: TEST_USER_ACCOUNT_ID,
                participants: {
                    [TEST_USER_ACCOUNT_ID]: {
                        notificationPreference: CONST.REPORT.NOTIFICATION_PREFERENCE.MUTE,
                    },
                },
                parentReportID: undefined,
                parentReportActionID: undefined,
            };
            const moneyRequestAction: ReportAction<typeof CONST.REPORT.ACTIONS.TYPE.IOU> = {
                reportActionID: MONEY_REQUEST_REPORT_ACTION_ID,
                reportID: expenseReport.reportID,
                actionName: CONST.REPORT.ACTIONS.TYPE.IOU,
                actorAccountID: TEST_USER_ACCOUNT_ID,
                childReportID: TRANSACTION_THREAD_REPORT_ID,
                created: '2026-06-01 00:00:00.000',
                message: [
                    {
                        type: CONST.REPORT.MESSAGE.TYPE.COMMENT,
                        html: 'Test Merchant',
                        text: 'Test Merchant',
                    },
                ],
                originalMessage: {
                    IOUTransactionID: expenseTransaction.transactionID,
                    amount: expenseTransaction.amount,
                    currency: expenseTransaction.currency,
                    type: CONST.IOU.REPORT_ACTION_TYPE.CREATE,
                },
                pendingAction: null,
                shouldShow: true,
            };
            const transactionThreadReport: Report = {
                ...createRandomReport(100, undefined),
                reportID: TRANSACTION_THREAD_REPORT_ID,
                type: CONST.REPORT.TYPE.CHAT,
                parentReportID: expenseReport.reportID,
                parentReportActionID: moneyRequestAction.reportActionID,
                chatReportID: chatReport?.reportID,
                policyID: policy?.id,
            };

            await Onyx.set(ONYXKEYS.SELF_DM_REPORT_ID, SELF_DM_REPORT_ID);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${SELF_DM_REPORT_ID}`, selfDMReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${TRANSACTION_THREAD_REPORT_ID}`, transactionThreadReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${expenseReport.reportID}`, {
                [moneyRequestAction.reportActionID]: moneyRequestAction,
            });
            await waitForBatchedUpdates();
        };

        afterEach(async () => {
            await Onyx.clear();
            jest.clearAllMocks();
        });

        it('should reject a money request and return navigation route', async () => {
            // Given: An expense report (not IOU) for testing state update
            const expenseReport = {...iouReport, type: CONST.REPORT.TYPE.EXPENSE};
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${iouReport?.reportID}`, expenseReport);
            await waitForBatchedUpdates();

            // When: Reject the money request
            if (!transaction?.transactionID || !iouReport?.reportID) {
                throw new Error('Required transaction or report data is missing');
            }
            const result = rejectMoneyRequest(transaction.transactionID, iouReport.reportID, comment, policy, TEST_USER_ACCOUNT_ID, TEST_USER_EMAIL, [CONST.BETAS.ALL]);

            // Then: Should return navigation route to chat report
            expect(result).toBe(ROUTES.REPORT_WITH_ID.getRoute(iouReport.reportID));
        });

        it('should add AUTO_REPORTED_REJECTED_EXPENSE violation for expense reports', async () => {
            // Given: An expense report (not IOU)
            const expenseReport = {...iouReport, type: CONST.REPORT.TYPE.EXPENSE};
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${iouReport?.reportID}`, expenseReport);
            await waitForBatchedUpdates();

            // When: Reject the money request
            if (!transaction?.transactionID || !iouReport?.reportID) {
                throw new Error('Required transaction or report data is missing');
            }
            rejectMoneyRequest(transaction.transactionID, iouReport.reportID, comment, policy, TEST_USER_ACCOUNT_ID, TEST_USER_EMAIL, [CONST.BETAS.ALL]);
            await waitForBatchedUpdates();

            // Then: Verify violation is added
            const violations = await getOnyxValue(`${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transaction?.transactionID}`);
            expect(violations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: CONST.VIOLATIONS.AUTO_REPORTED_REJECTED_EXPENSE,
                        type: CONST.VIOLATION_TYPES.WARNING,
                        data: expect.objectContaining({
                            comment,
                        }),
                    }),
                ]),
            );
        });

        it('should move a single rejected expense to selfDM when submission frequency is disabled', async () => {
            // eslint-disable-next-line rulesdir/no-multiple-api-calls
            const writeSpy = jest.spyOn(API, 'write').mockImplementation(jest.fn());
            const manualSubmissionPolicy = {
                ...policy,
                autoReporting: false,
            };
            const expenseReport = {...iouReport, type: CONST.REPORT.TYPE.EXPENSE};

            await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${manualSubmissionPolicy?.id}`, manualSubmissionPolicy);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${expenseReport.reportID}`, expenseReport);
            await seedSelfDMAndMoneyRequestThread(expenseReport, transaction);
            await waitForBatchedUpdates();

            if (!transaction?.transactionID || !expenseReport.reportID) {
                throw new Error('Required transaction or report data is missing');
            }

            rejectMoneyRequest(transaction.transactionID, expenseReport.reportID, comment, manualSubmissionPolicy, TEST_USER_ACCOUNT_ID, TEST_USER_EMAIL, [CONST.BETAS.ALL]);
            await waitForBatchedUpdates();

            const updatedTransaction = await getOnyxValue(`${ONYXKEYS.COLLECTION.TRANSACTION}${transaction.transactionID}`);
            expect(updatedTransaction?.reportID).toBe(CONST.REPORT.UNREPORTED_REPORT_ID);

            const selfDMReportActions = await getOnyxValue(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${SELF_DM_REPORT_ID}`);
            const selfDMMoneyRequestAction = Object.values(selfDMReportActions ?? {}).find((action) => action?.originalMessage?.IOUTransactionID === transaction.transactionID);
            expect(selfDMMoneyRequestAction?.originalMessage?.type).toBe(CONST.IOU.REPORT_ACTION_TYPE.TRACK);

            const transactionThreadReport = await getOnyxValue(`${ONYXKEYS.COLLECTION.REPORT}${TRANSACTION_THREAD_REPORT_ID}`);
            expect(transactionThreadReport?.parentReportID).toBe(SELF_DM_REPORT_ID);
            expect(transactionThreadReport?.parentReportActionID).toBe(selfDMMoneyRequestAction?.reportActionID);
            expect(transactionThreadReport?.chatReportID).toBe(SELF_DM_REPORT_ID);
            expect(transactionThreadReport?.policyID).toBe(CONST.POLICY.ID_FAKE);

            const transactionThreadActions = await getOnyxValue(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${TRANSACTION_THREAD_REPORT_ID}`);
            const unreportedAction = Object.values(transactionThreadActions ?? {}).find((action) => action?.actionName === CONST.REPORT.ACTIONS.TYPE.UNREPORTED_TRANSACTION);
            expect(unreportedAction).toBeDefined();

            expect(writeSpy).toHaveBeenCalledWith(
                WRITE_COMMANDS.REJECT_MONEY_REQUEST,
                expect.objectContaining({
                    rejectedToReportID: undefined,
                    selfDMReportID: SELF_DM_REPORT_ID,
                    createdIOUReportActionID: selfDMMoneyRequestAction?.reportActionID,
                    expenseMovedReportActionID: unreportedAction?.reportActionID,
                }),
                expect.anything(),
            );
            writeSpy.mockRestore();
        });

        it('should the createdIOUReportActionID parameter not be undefined when rejecting an expense to an open report', async () => {
            // Mock API.write for this test

            const writeSpy = jest.spyOn(API, 'write').mockImplementation(jest.fn());

            const openingReport = {
                ...createRandomReport(3, undefined),
                type: CONST.REPORT.TYPE.EXPENSE,
                ownerAccountID: TEST_USER_ACCOUNT_ID,
                managerID: MANAGER_ACCOUNT_ID,
                total: 0,
                currency: CONST.CURRENCY.USD,
                stateNum: CONST.REPORT.STATE_NUM.OPEN,
                statusNum: CONST.REPORT.STATUS_NUM.OPEN,
                policyID: policy?.id,
                chatReportID: chatReport?.reportID,
            };

            const secondTransaction = {
                ...createRandomTransaction(2),
                reportID: iouReport?.reportID,
                amount,
                currency: CONST.CURRENCY.USD,
                merchant: 'Test Merchant',
                transactionID: '2',
            };

            // Given: An expense report (not IOU)
            const expenseReport = {...iouReport, type: CONST.REPORT.TYPE.EXPENSE, total: amount * 2};
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${expenseReport.reportID}`, expenseReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${openingReport.reportID}`, openingReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${secondTransaction.transactionID}`, secondTransaction);
            await waitForBatchedUpdates();

            // When: Reject the money request
            if (!transaction?.transactionID || !iouReport?.reportID) {
                throw new Error('Required transaction or report data is missing');
            }
            rejectMoneyRequest(transaction.transactionID, iouReport.reportID, comment, policy, TEST_USER_ACCOUNT_ID, TEST_USER_EMAIL, [CONST.BETAS.ALL]);
            await waitForBatchedUpdates();

            // Then: createdIOUReportActionID shouldn't be undefined
            expect(writeSpy).toHaveBeenCalledWith(
                expect.anything(),
                expect.not.objectContaining({
                    createdIOUReportActionID: undefined,
                }),
                expect.anything(),
            );
            writeSpy.mockRestore();
        });

        it('should reuse the same rejected report when rejecting multiple expenses from the same report', async () => {
            const secondTransaction = {
                ...createRandomTransaction(2),
                reportID: iouReport?.reportID,
                amount,
                currency: CONST.CURRENCY.USD,
                merchant: 'Second Test Merchant',
                transactionID: '2',
            };

            const expenseReport = {...iouReport, type: CONST.REPORT.TYPE.EXPENSE, total: amount * 2};
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${expenseReport.reportID}`, expenseReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${secondTransaction.transactionID}`, secondTransaction);
            await waitForBatchedUpdates();

            const sharedRejectedToReportID = '9999';
            let existingRejectedReport: OnyxEntry<Report>;
            const setExistingRejectedReport = (nextRejectedReport: OnyxEntry<Report>) => {
                existingRejectedReport = nextRejectedReport;
            };

            if (!transaction?.transactionID || !iouReport?.reportID) {
                throw new Error('Required transaction or report data is missing');
            }

            rejectMoneyRequest(transaction.transactionID, iouReport.reportID, comment, policy, TEST_USER_ACCOUNT_ID, TEST_USER_EMAIL, [CONST.BETAS.ALL], {
                sharedRejectedToReportID,
                existingRejectedReport,
                setExistingRejectedReport,
            });

            rejectMoneyRequest(secondTransaction.transactionID, iouReport.reportID, comment, policy, TEST_USER_ACCOUNT_ID, TEST_USER_EMAIL, [CONST.BETAS.ALL], {
                sharedRejectedToReportID,
                existingRejectedReport,
                setExistingRejectedReport,
            });
            await waitForBatchedUpdates();

            let allReports: OnyxCollection<Report>;
            await getOnyxData({
                key: ONYXKEYS.COLLECTION.REPORT,
                waitForCollectionCallback: true,
                callback: (reports) => {
                    allReports = reports;
                },
            });
            const rejectedReports = Object.values(allReports ?? {}).filter(
                (reportCandidate) =>
                    reportCandidate?.reportID !== expenseReport.reportID &&
                    reportCandidate?.chatReportID === chatReport?.reportID &&
                    reportCandidate?.type === CONST.REPORT.TYPE.EXPENSE &&
                    reportCandidate?.ownerAccountID === TEST_USER_ACCOUNT_ID,
            );

            expect(rejectedReports).toHaveLength(1);
            expect(rejectedReports.at(0)?.reportID).toBe(sharedRejectedToReportID);

            const firstRejectedTransaction = await getOnyxValue(`${ONYXKEYS.COLLECTION.TRANSACTION}${transaction.transactionID}`);
            const secondRejectedTransaction = await getOnyxValue(`${ONYXKEYS.COLLECTION.TRANSACTION}${secondTransaction.transactionID}`);

            expect(firstRejectedTransaction?.reportID).toBe(sharedRejectedToReportID);
            expect(secondRejectedTransaction?.reportID).toBe(sharedRejectedToReportID);
        });
    });

    describe('rejectExpenseReport', () => {
        const comment = 'This report is rejected';
        const TEST_USER_ACCOUNT_ID = 1;
        const SUBMITTER_ACCOUNT_ID = 2;
        const APPROVER_ACCOUNT_ID = 3;
        const CURRENT_USER_DISPLAY_NAME = 'Test User';
        const CURRENT_USER_AVATAR = 'https://example.com/avatar.png';
        const SELF_DM_REPORT_ID = 'reportRejectSelfDM';
        const TRANSACTION_ID = 'reportRejectTransaction';
        const TRANSACTION_THREAD_REPORT_ID = 'reportRejectTransactionThread';
        const MONEY_REQUEST_REPORT_ACTION_ID = 'reportRejectMoneyRequestAction';

        let policy: Policy;
        let expenseReport: Report;

        beforeEach(async () => {
            policy = createRandomPolicy(1);

            expenseReport = {
                ...createRandomReport(1, undefined),
                type: CONST.REPORT.TYPE.EXPENSE,
                ownerAccountID: SUBMITTER_ACCOUNT_ID,
                managerID: APPROVER_ACCOUNT_ID,
                total: 10000,
                currency: CONST.CURRENCY.USD,
                stateNum: CONST.REPORT.STATE_NUM.SUBMITTED,
                statusNum: CONST.REPORT.STATUS_NUM.SUBMITTED,
                policyID: policy.id,
            };

            await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${policy.id}`, policy);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${expenseReport.reportID}`, expenseReport);
            await Onyx.set(ONYXKEYS.SESSION, {accountID: TEST_USER_ACCOUNT_ID});
            await waitForBatchedUpdates();
        });

        afterEach(async () => {
            await Onyx.clear();
            jest.clearAllMocks();
        });

        it('should route submitter rejects through REJECT_MONEY_REQUEST when submission frequency is disabled', async () => {
            const manualSubmissionPolicy = {
                ...policy,
                autoReporting: false,
            };
            const chatReport: Report = {
                ...createRandomReport(200, CONST.REPORT.CHAT_TYPE.POLICY_EXPENSE_CHAT),
                reportID: 'reportRejectPolicyExpenseChat',
                type: CONST.REPORT.TYPE.CHAT,
                policyID: manualSubmissionPolicy.id,
            };
            const manualSubmissionReport: Report = {
                ...expenseReport,
                chatReportID: chatReport.reportID,
            };
            const transaction: Transaction = {
                ...createRandomTransaction(200),
                transactionID: TRANSACTION_ID,
                reportID: manualSubmissionReport.reportID,
                amount: 10000,
                currency: CONST.CURRENCY.USD,
            };
            const selfDMReport: Report = {
                ...createRandomReport(201, CONST.REPORT.CHAT_TYPE.SELF_DM),
                reportID: SELF_DM_REPORT_ID,
                type: CONST.REPORT.TYPE.CHAT,
                ownerAccountID: SUBMITTER_ACCOUNT_ID,
                participants: {
                    [SUBMITTER_ACCOUNT_ID]: {
                        notificationPreference: CONST.REPORT.NOTIFICATION_PREFERENCE.MUTE,
                    },
                },
            };
            const moneyRequestAction: ReportAction<typeof CONST.REPORT.ACTIONS.TYPE.IOU> = {
                reportActionID: MONEY_REQUEST_REPORT_ACTION_ID,
                reportID: manualSubmissionReport.reportID,
                actionName: CONST.REPORT.ACTIONS.TYPE.IOU,
                actorAccountID: SUBMITTER_ACCOUNT_ID,
                childReportID: TRANSACTION_THREAD_REPORT_ID,
                created: '2026-06-01 00:00:00.000',
                message: [
                    {
                        type: CONST.REPORT.MESSAGE.TYPE.COMMENT,
                        html: 'Test Merchant',
                        text: 'Test Merchant',
                    },
                ],
                originalMessage: {
                    IOUTransactionID: TRANSACTION_ID,
                    amount: transaction.amount,
                    currency: transaction.currency,
                    type: CONST.IOU.REPORT_ACTION_TYPE.CREATE,
                },
                pendingAction: null,
                shouldShow: true,
            };
            const transactionThreadReport: Report = {
                ...createRandomReport(202, undefined),
                reportID: TRANSACTION_THREAD_REPORT_ID,
                type: CONST.REPORT.TYPE.CHAT,
                parentReportID: manualSubmissionReport.reportID,
                parentReportActionID: moneyRequestAction.reportActionID,
                chatReportID: chatReport.reportID,
                policyID: manualSubmissionPolicy.id,
            };

            await Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${manualSubmissionPolicy.id}`, manualSubmissionPolicy);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${chatReport.reportID}`, chatReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${manualSubmissionReport.reportID}`, manualSubmissionReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${SELF_DM_REPORT_ID}`, selfDMReport);
            await Onyx.set(ONYXKEYS.SELF_DM_REPORT_ID, SELF_DM_REPORT_ID);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${TRANSACTION_THREAD_REPORT_ID}`, transactionThreadReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${manualSubmissionReport.reportID}`, {
                [moneyRequestAction.reportActionID]: moneyRequestAction,
            });
            await Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${TRANSACTION_ID}`, transaction);
            await waitForBatchedUpdates();

            // eslint-disable-next-line rulesdir/no-multiple-api-calls
            const writeSpy = jest.spyOn(API, 'write').mockImplementation(jest.fn());

            rejectExpenseReport(
                manualSubmissionReport,
                SUBMITTER_ACCOUNT_ID,
                comment,
                TEST_USER_ACCOUNT_ID,
                CURRENT_USER_DISPLAY_NAME,
                CURRENT_USER_AVATAR,
                manualSubmissionPolicy,
                RORY_EMAIL,
                [CONST.BETAS.ALL],
            );
            await waitForBatchedUpdates();

            expect(writeSpy).toHaveBeenCalledTimes(1);
            expect(writeSpy).toHaveBeenCalledWith(
                WRITE_COMMANDS.REJECT_MONEY_REQUEST,
                expect.objectContaining({
                    transactionID: TRANSACTION_ID,
                    reportID: manualSubmissionReport.reportID,
                    rejectedToReportID: undefined,
                    selfDMReportID: SELF_DM_REPORT_ID,
                }),
                expect.anything(),
            );
            writeSpy.mockRestore();
        });

        it('should call API.write with REJECT_EXPENSE_REPORT command', async () => {
            // eslint-disable-next-line rulesdir/no-multiple-api-calls
            const writeSpy = jest.spyOn(API, 'write').mockImplementation(jest.fn());

            rejectExpenseReport(expenseReport, SUBMITTER_ACCOUNT_ID, comment, TEST_USER_ACCOUNT_ID, CURRENT_USER_DISPLAY_NAME, CURRENT_USER_AVATAR);
            await waitForBatchedUpdates();

            expect(writeSpy).toHaveBeenCalledWith(
                WRITE_COMMANDS.REJECT_EXPENSE_REPORT,
                expect.objectContaining({
                    reportID: expenseReport.reportID,
                    targetAccountID: SUBMITTER_ACCOUNT_ID,
                    comment: getParsedComment(comment),
                }),
                expect.anything(),
            );
            writeSpy.mockRestore();
        });

        it('queues getParsedComment output for REJECT_EXPENSE_REPORT when reject reason contains markdown', async () => {
            const markdownComment = 'Rejected because **important**';

            // eslint-disable-next-line rulesdir/no-multiple-api-calls
            const writeSpy = jest.spyOn(API, 'write').mockImplementation(jest.fn());

            rejectExpenseReport(expenseReport, SUBMITTER_ACCOUNT_ID, markdownComment, TEST_USER_ACCOUNT_ID, CURRENT_USER_DISPLAY_NAME, CURRENT_USER_AVATAR);
            await waitForBatchedUpdates();

            expect(writeSpy).toHaveBeenCalledWith(
                WRITE_COMMANDS.REJECT_EXPENSE_REPORT,
                expect.objectContaining({
                    comment: getParsedComment(markdownComment),
                }),
                expect.anything(),
            );
            writeSpy.mockRestore();
        });

        it('should optimistically update the report when rejecting to submitter', async () => {
            rejectExpenseReport(expenseReport, SUBMITTER_ACCOUNT_ID, comment, TEST_USER_ACCOUNT_ID, CURRENT_USER_DISPLAY_NAME, CURRENT_USER_AVATAR);
            await waitForBatchedUpdates();

            const updatedReport = await getOnyxValue(`${ONYXKEYS.COLLECTION.REPORT}${expenseReport.reportID}`);
            expect(updatedReport?.managerID).toBe(SUBMITTER_ACCOUNT_ID);
            expect(updatedReport?.stateNum).toBe(CONST.REPORT.STATE_NUM.OPEN);
            expect(updatedReport?.statusNum).toBe(CONST.REPORT.STATUS_NUM.OPEN);
        });

        it('should optimistically update the report when rejecting to a previous approver', async () => {
            rejectExpenseReport(expenseReport, APPROVER_ACCOUNT_ID, comment, TEST_USER_ACCOUNT_ID, CURRENT_USER_DISPLAY_NAME, CURRENT_USER_AVATAR);
            await waitForBatchedUpdates();

            const updatedReport = await getOnyxValue(`${ONYXKEYS.COLLECTION.REPORT}${expenseReport.reportID}`);
            expect(updatedReport?.managerID).toBe(APPROVER_ACCOUNT_ID);
            expect(updatedReport?.stateNum).toBe(CONST.REPORT.STATE_NUM.SUBMITTED);
            expect(updatedReport?.statusNum).toBe(CONST.REPORT.STATUS_NUM.SUBMITTED);
        });

        it('should create optimistic report actions with passed user details', async () => {
            rejectExpenseReport(expenseReport, SUBMITTER_ACCOUNT_ID, comment, TEST_USER_ACCOUNT_ID, CURRENT_USER_DISPLAY_NAME, CURRENT_USER_AVATAR);
            await waitForBatchedUpdates();

            const reportActions = await getOnyxValue(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${expenseReport.reportID}`);
            const actions = Object.values(reportActions ?? {});

            const rejectAction = actions.find((action) => action?.actionName === CONST.REPORT.ACTIONS.TYPE.REJECTED_TO_SUBMITTER);
            expect(rejectAction).toBeDefined();
            expect(rejectAction?.actorAccountID).toBe(TEST_USER_ACCOUNT_ID);
            expect(rejectAction?.person?.[0]?.text).toBe(CURRENT_USER_DISPLAY_NAME);
            expect(rejectAction?.avatar).toBe(CURRENT_USER_AVATAR);

            const commentAction = actions.find((action) => action?.actionName === CONST.REPORT.ACTIONS.TYPE.ADD_COMMENT);
            expect(commentAction).toBeDefined();
            expect(commentAction?.actorAccountID).toBe(TEST_USER_ACCOUNT_ID);
            expect(commentAction?.person?.[0]?.text).toBe(CURRENT_USER_DISPLAY_NAME);
            expect(commentAction?.avatar).toBe(CURRENT_USER_AVATAR);
        });
    });

    describe('markRejectViolationAsResolved', () => {
        let transaction: OnyxEntry<Transaction>;
        let iouReport: OnyxEntry<Report>;

        beforeEach(async () => {
            transaction = createRandomTransaction(1);
            iouReport = createRandomReport(1, undefined);

            await Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${transaction?.transactionID}`, transaction);
            await Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${iouReport?.reportID}`, iouReport);
            await Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transaction?.transactionID}`, [
                {
                    name: CONST.VIOLATIONS.AUTO_REPORTED_REJECTED_EXPENSE,
                    type: CONST.VIOLATION_TYPES.WARNING,
                    data: {comment: 'Test reject reason'},
                },
            ]);
            await waitForBatchedUpdates();
        });

        afterEach(async () => {
            await Onyx.clear();
            jest.clearAllMocks();
        });

        it('should remove AUTO_REPORTED_REJECTED_EXPENSE violation when online', async () => {
            // When: Mark violation as resolved while online
            if (!transaction?.transactionID || !iouReport?.reportID) {
                throw new Error('Required transaction or report data is missing');
            }
            markRejectViolationAsResolved(transaction.transactionID, false, iouReport.reportID);
            await waitForBatchedUpdates();

            // Then: Verify violation is removed
            const violations = await getOnyxValue(`${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transaction?.transactionID}`);
            expect(violations).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: CONST.VIOLATIONS.AUTO_REPORTED_REJECTED_EXPENSE,
                    }),
                ]),
            );
        });

        it('should remove AUTO_REPORTED_REJECTED_EXPENSE violation when offline', async () => {
            // When: Mark violation as resolved while offline
            if (!transaction?.transactionID || !iouReport?.reportID) {
                throw new Error('Required transaction or report data is missing');
            }
            markRejectViolationAsResolved(transaction.transactionID, true, iouReport.reportID);
            await waitForBatchedUpdates();

            // Then: Verify violation is removed
            const violations = await getOnyxValue(`${ONYXKEYS.COLLECTION.TRANSACTION_VIOLATIONS}${transaction?.transactionID}`);
            expect(violations).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: CONST.VIOLATIONS.AUTO_REPORTED_REJECTED_EXPENSE,
                    }),
                ]),
            );
        });

        it('should call API.write with MARK_TRANSACTION_VIOLATION_AS_RESOLVED command', async () => {
            // eslint-disable-next-line rulesdir/no-multiple-api-calls
            const writeSpy = jest.spyOn(API, 'write').mockImplementation(jest.fn());

            if (!transaction?.transactionID || !iouReport?.reportID) {
                throw new Error('Required transaction or report data is missing');
            }

            // When: Mark violation as resolved
            markRejectViolationAsResolved(transaction.transactionID, false, iouReport.reportID);
            await waitForBatchedUpdates();

            // Then: API.write should be called with the correct command and transactionID
            expect(writeSpy).toHaveBeenCalledWith(
                WRITE_COMMANDS.MARK_TRANSACTION_VIOLATION_AS_RESOLVED,
                expect.objectContaining({
                    transactionID: transaction.transactionID,
                }),
                expect.anything(),
            );
            writeSpy.mockRestore();
        });

        it('should call notifyNewAction after resolving the violation', async () => {
            const {notifyNewAction} = require('@src/libs/actions/Report');

            if (!transaction?.transactionID || !iouReport?.reportID) {
                throw new Error('Required transaction or report data is missing');
            }

            // When: Mark violation as resolved while online
            markRejectViolationAsResolved(transaction.transactionID, false, iouReport.reportID);
            await waitForBatchedUpdates();

            // Then: notifyNewAction should be called
            expect(notifyNewAction).toHaveBeenCalled();
        });

        it('should not make API call or notify when reportID is undefined', async () => {
            // eslint-disable-next-line rulesdir/no-multiple-api-calls
            const writeSpy = jest.spyOn(API, 'write').mockImplementation(jest.fn());

            const {notifyNewAction} = require('@src/libs/actions/Report');

            if (!transaction?.transactionID) {
                throw new Error('Required transaction data is missing');
            }

            // When: Mark violation as resolved without reportID
            markRejectViolationAsResolved(transaction.transactionID, false, undefined);
            await waitForBatchedUpdates();

            // Then: API.write should not be called
            expect(writeSpy).not.toHaveBeenCalled();

            // Then: notifyNewAction should not be called
            expect(notifyNewAction).not.toHaveBeenCalled();

            writeSpy.mockRestore();
        });
    });
});
