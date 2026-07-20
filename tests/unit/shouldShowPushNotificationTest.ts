import Navigation from '@libs/Navigation/Navigation';
import shouldShowPushNotification from '@libs/Notification/PushNotification/shouldShowPushNotification';
import * as ReportActionsUtils from '@libs/ReportActionsUtils';

import * as Report from '@userActions/Report';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';

import type {PushPayload} from '@ua/react-native-airship';

import Onyx from 'react-native-onyx';

import waitForBatchedUpdates from '../utils/waitForBatchedUpdates';

jest.mock('@libs/Navigation/Navigation', () => ({
    __esModule: true,
    default: {
        getTopmostReportId: jest.fn(() => undefined),
        getTopmostSuperWideRHPReportID: jest.fn(() => undefined),
    },
}));

jest.mock('@libs/NetworkState', () => ({
    getIsOffline: jest.fn(() => false),
}));

jest.mock('@userActions/Report', () => ({
    shouldShowReportActionNotification: jest.fn(() => false),
}));

const CURRENT_USER_ACCOUNT_ID = 1;
const EXPENSE_REPORT_ID = '100';
const BACKGROUND_REPORT_ID = '200';
const CHAT_REPORT_ID = '300';
const TRANSACTION_THREAD_REPORT_ID = '400';

const mockedGetTopmostReportId = jest.mocked(Navigation.getTopmostReportId);
const mockedGetTopmostSuperWideRHPReportID = jest.mocked(Navigation.getTopmostSuperWideRHPReportID);
const mockedShouldShowReportActionNotification = jest.mocked(Report.shouldShowReportActionNotification);

describe('shouldShowPushNotification', () => {
    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(async () => {
        mockedGetTopmostReportId.mockReturnValue(BACKGROUND_REPORT_ID);
        mockedGetTopmostSuperWideRHPReportID.mockReturnValue(EXPENSE_REPORT_ID);
        mockedShouldShowReportActionNotification.mockReturnValue(false);
        await Onyx.merge(ONYXKEYS.SESSION, {accountID: CURRENT_USER_ACCOUNT_ID});
        await Onyx.merge(`${ONYXKEYS.COLLECTION.REPORT}${EXPENSE_REPORT_ID}`, {
            reportID: EXPENSE_REPORT_ID,
            chatReportID: CHAT_REPORT_ID,
            type: CONST.REPORT.TYPE.EXPENSE,
        });
        await Onyx.merge(`${ONYXKEYS.COLLECTION.REPORT}${BACKGROUND_REPORT_ID}`, {
            reportID: BACKGROUND_REPORT_ID,
            type: CONST.REPORT.TYPE.CHAT,
        });
        await Onyx.merge(`${ONYXKEYS.COLLECTION.REPORT}${CHAT_REPORT_ID}`, {
            reportID: CHAT_REPORT_ID,
            type: CONST.REPORT.TYPE.CHAT,
        });
        await Onyx.merge(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${EXPENSE_REPORT_ID}`, {
            'iou-action-id': {
                reportActionID: 'iou-action-id',
                childReportID: TRANSACTION_THREAD_REPORT_ID,
                actionName: CONST.REPORT.ACTIONS.TYPE.IOU,
                created: '2026-01-01 00:00:00.000',
                originalMessage: {
                    type: CONST.IOU.REPORT_ACTION_TYPE.CREATE,
                    amount: 100,
                    currency: CONST.CURRENCY.USD,
                    IOUTransactionID: 'transaction-id',
                },
                message: [{type: CONST.REPORT.MESSAGE.TYPE.COMMENT, html: '$1 expense', text: '$1 expense'}],
            },
        });
        await waitForBatchedUpdates();
    });

    afterEach(() => Onyx.clear());

    it('derives the transaction thread from the focused super-wide RHP report', () => {
        const getOneTransactionThreadReportIDSpy = jest.spyOn(ReportActionsUtils, 'getOneTransactionThreadReportID').mockReturnValue(TRANSACTION_THREAD_REPORT_ID);
        const pushPayload = {
            extras: {
                payload: {
                    title: 'New comment',
                    subtitle: '',
                    type: 'reportComment',
                    reportID: Number(TRANSACTION_THREAD_REPORT_ID),
                    reportActionID: 'report-action-id',
                },
            },
        } as unknown as PushPayload;

        expect(shouldShowPushNotification(pushPayload)).toBe(false);
        expect(getOneTransactionThreadReportIDSpy).toHaveBeenCalledWith(
            expect.objectContaining({reportID: EXPENSE_REPORT_ID}),
            expect.objectContaining({reportID: CHAT_REPORT_ID}),
            expect.objectContaining({
                'iou-action-id': expect.objectContaining({childReportID: TRANSACTION_THREAD_REPORT_ID}),
            }),
            false,
        );
        expect(mockedShouldShowReportActionNotification).toHaveBeenCalledWith(TRANSACTION_THREAD_REPORT_ID, TRANSACTION_THREAD_REPORT_ID, CURRENT_USER_ACCOUNT_ID, null, true);
        expect(mockedGetTopmostReportId).not.toHaveBeenCalled();
    });
});
