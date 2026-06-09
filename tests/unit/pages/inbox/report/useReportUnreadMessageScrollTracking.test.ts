import {act, renderHook} from '@testing-library/react-native';
import type {ViewToken} from 'react-native';
import useReportUnreadMessageScrollTracking from '@pages/inbox/report/useReportUnreadMessageScrollTracking';
import CONST from '@src/CONST';

jest.mock('@react-navigation/native', () => ({
    useIsFocused: () => true,
}));

jest.mock('@userActions/Report', () => ({
    readNewestAction: jest.fn(),
}));

type HookProps = Parameters<typeof useReportUnreadMessageScrollTracking>[0];

function getViewableItem(reportActionID: string, index: number): ViewToken {
    return {
        item: {reportActionID},
        key: reportActionID,
        index,
        isViewable: true,
    } as ViewToken;
}

function renderUseReportUnreadMessageScrollTracking(overrides: Partial<HookProps> = {}) {
    const props: HookProps = {
        reportID: 'report-1',
        isInverted: true,
        currentVerticalScrollingOffsetRef: {current: 0},
        readActionSkippedRef: {current: false},
        unreadMarkerReportActionIndex: 2,
        hasNewerActions: false,
        newestReportActionID: 'newest-action',
        onTrackScrolling: jest.fn(),
        hasOnceLoadedReportActions: true,
        ...overrides,
    };

    return renderHook((currentProps: HookProps) => useReportUnreadMessageScrollTracking(currentProps), {
        initialProps: props,
    });
}

describe('useReportUnreadMessageScrollTracking', () => {
    it('keeps the floating counter visible when the unread marker is visible but the newest action is not', () => {
        const {result} = renderUseReportUnreadMessageScrollTracking();

        act(() => {
            result.current.onViewableItemsChanged({
                viewableItems: [getViewableItem('unread-marker-action', 2), getViewableItem('older-action', 3)],
                changed: [],
            });
        });

        expect(result.current.isFloatingMessageCounterVisible).toBe(true);
    });

    it('hides the floating counter when the unread marker and newest action are visible with no newer pages', () => {
        const {result} = renderUseReportUnreadMessageScrollTracking();

        act(() => {
            result.current.onViewableItemsChanged({
                viewableItems: [getViewableItem('unread-marker-action', 2), getViewableItem('older-action', 3)],
                changed: [],
            });
        });
        expect(result.current.isFloatingMessageCounterVisible).toBe(true);

        act(() => {
            result.current.onViewableItemsChanged({
                viewableItems: [getViewableItem('newest-action', 0), getViewableItem('unread-marker-action', 2)],
                changed: [],
            });
        });

        expect(result.current.isFloatingMessageCounterVisible).toBe(false);
    });

    it('keeps the floating counter visible when the newest loaded action is visible but newer pages still exist', () => {
        const {result} = renderUseReportUnreadMessageScrollTracking({hasNewerActions: true});

        act(() => {
            result.current.onViewableItemsChanged({
                viewableItems: [getViewableItem('newest-action', 0), getViewableItem('unread-marker-action', 2)],
                changed: [],
            });
        });

        expect(result.current.isFloatingMessageCounterVisible).toBe(true);
    });

    it('preserves the scroll threshold behavior when there is no unread marker', () => {
        const currentVerticalScrollingOffsetRef = {
            current: CONST.REPORT.ACTIONS.LATEST_MESSAGES_PILL_SCROLL_OFFSET_THRESHOLD + 1,
        };
        const {result} = renderUseReportUnreadMessageScrollTracking({
            currentVerticalScrollingOffsetRef,
            unreadMarkerReportActionIndex: -1,
        });

        act(() => {
            result.current.trackVerticalScrolling(undefined);
        });

        expect(result.current.isFloatingMessageCounterVisible).toBe(true);

        currentVerticalScrollingOffsetRef.current = CONST.REPORT.ACTIONS.LATEST_MESSAGES_PILL_SCROLL_OFFSET_THRESHOLD - 1;
        act(() => {
            result.current.trackVerticalScrolling(undefined);
        });

        expect(result.current.isFloatingMessageCounterVisible).toBe(false);
    });
});
