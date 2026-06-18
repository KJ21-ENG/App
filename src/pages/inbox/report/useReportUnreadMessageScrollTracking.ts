import {useIsFocused} from '@react-navigation/native';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';
import type {NativeScrollEvent, NativeSyntheticEvent, ViewToken} from 'react-native';
import CONST from '@src/CONST';

type Args = {
    /** The report ID */
    reportID: string;

    /** Whether the FlatList is inverted, we need it to determine if the current unread message is visible. */
    isInverted: boolean;

    /** The current offset of scrolling from either top or bottom of chat list */
    currentVerticalScrollingOffsetRef: RefObject<number>;

    /** Called when the unread-marker action is within the viewport, on every viewability change */
    onUnreadActionVisible: () => void;

    /** The index of the unread report action */
    unreadMarkerReportActionIndex: number;

    /** Whether the report has newer actions to load */
    hasNewerActions: boolean;

    /** Callback to call on every scroll event */
    onTrackScrolling: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;

    /** The indexes of the action badge target report actions in the sorted visible actions list */
    actionBadgeTargetIndexes?: number[];
};

export default function useReportUnreadMessageScrollTracking({
    reportID,
    currentVerticalScrollingOffsetRef,
    hasNewerActions,
    onUnreadActionVisible,
    onTrackScrolling,
    unreadMarkerReportActionIndex,
    isInverted,
    actionBadgeTargetIndexes = [],
}: Args) {
    const [isFloatingMessageCounterVisible, setIsFloatingMessageCounterVisible] = useState(false);
    const [isActionBadgeAboveViewport, setIsActionBadgeAboveViewport] = useState(false);
    const [actionBadgeTargetIndex, setActionBadgeTargetIndex] = useState(-1);
    const isFocused = useIsFocused();
    const ref = useRef<{
        previousViewableItems: ViewToken[];
        reportID: string;
        unreadMarkerReportActionIndex: number;
        isFocused: boolean;
        onUnreadActionVisible: () => void;
        actionBadgeTargetIndexes: number[];
    }>({
        reportID,
        unreadMarkerReportActionIndex,
        previousViewableItems: [],
        isFocused: true,
        onUnreadActionVisible,
        actionBadgeTargetIndexes,
    });
    // We want to save the updated value on ref to use it in onViewableItemsChanged
    // because FlatList requires the callback to be stable and we cannot add a dependency on the useCallback.
    useEffect(() => {
        ref.current.reportID = reportID;
        ref.current.previousViewableItems = [];
        setIsActionBadgeAboveViewport(false);
        setActionBadgeTargetIndex(-1);
    }, [reportID]);

    useEffect(() => {
        ref.current.isFocused = isFocused;
    }, [isFocused]);

    useEffect(() => {
        ref.current.onUnreadActionVisible = onUnreadActionVisible;
    }, [onUnreadActionVisible]);

    /**
     * On every scroll event we want to:
     * Show/hide the latest message pill when user is scrolling back/forth in the history of messages.
     * Call any other callback that the component might need
     */
    const trackVerticalScrolling = (event: NativeSyntheticEvent<NativeScrollEvent> | undefined) => {
        if (event) {
            onTrackScrolling(event);
        }
        const hasUnreadMarkerReportAction = unreadMarkerReportActionIndex !== -1;

        // display floating button if we're scrolled more than the offset
        if (
            currentVerticalScrollingOffsetRef.current > CONST.REPORT.ACTIONS.LATEST_MESSAGES_PILL_SCROLL_OFFSET_THRESHOLD &&
            !isFloatingMessageCounterVisible &&
            !hasUnreadMarkerReportAction
        ) {
            setIsFloatingMessageCounterVisible(true);
        }

        // hide floating button if we're scrolled closer than the offset
        if (
            currentVerticalScrollingOffsetRef.current < CONST.REPORT.ACTIONS.LATEST_MESSAGES_PILL_SCROLL_OFFSET_THRESHOLD &&
            isFloatingMessageCounterVisible &&
            !hasUnreadMarkerReportAction &&
            !hasNewerActions
        ) {
            setIsFloatingMessageCounterVisible(false);
        }
    };

    const onViewableItemsChanged = useCallback(({viewableItems}: {viewableItems: ViewToken[]; changed: ViewToken[]}) => {
        if (!ref.current.isFocused) {
            return;
        }

        ref.current.previousViewableItems = viewableItems;
        const viewableIndexes = viewableItems.map((viewableItem) => viewableItem.index).filter((value) => typeof value === 'number');

        if (viewableIndexes.length === 0) {
            setIsActionBadgeAboveViewport(false);
            setActionBadgeTargetIndex(-1);
            return;
        }

        const maxIndex = Math.max(...viewableIndexes);
        const minIndex = Math.min(...viewableIndexes);
        const unreadActionIndex = ref.current.unreadMarkerReportActionIndex;
        const hasUnreadMarkerReportAction = unreadActionIndex !== -1;
        const unreadActionVisible = isInverted ? unreadActionIndex >= minIndex : unreadActionIndex <= maxIndex;

        // display floating button if the unread report action is out of view
        if (!unreadActionVisible && hasUnreadMarkerReportAction) {
            setIsFloatingMessageCounterVisible(true);
        }
        // hide floating button if the unread report action becomes visible
        if (unreadActionVisible && hasUnreadMarkerReportAction) {
            setIsFloatingMessageCounterVisible(false);
        }

        // when the unread action scrolls into view, the consumer decides whether a skipped mark-as-read needs completing
        if (unreadActionVisible) {
            ref.current.onUnreadActionVisible();
        }

        // Track whether any action badge target is visible, or whether the nearest target is above the viewport.
        const badgeTargetIndexes = ref.current.actionBadgeTargetIndexes;
        const isAnyBadgeTargetVisible = badgeTargetIndexes.some((index) => index >= minIndex && index <= maxIndex);
        const badgeTargetIndexesAboveViewport = isInverted
            ? badgeTargetIndexes.filter((index) => index > maxIndex)
            : badgeTargetIndexes.filter((index) => index < minIndex);
        if (isAnyBadgeTargetVisible || badgeTargetIndexesAboveViewport.length === 0) {
            setIsActionBadgeAboveViewport(false);
            setActionBadgeTargetIndex(-1);
        } else {
            const nearestBadgeTargetIndex = isInverted ? Math.min(...badgeTargetIndexesAboveViewport) : Math.max(...badgeTargetIndexesAboveViewport);
            setIsActionBadgeAboveViewport(true);
            setActionBadgeTargetIndex(nearestBadgeTargetIndex);
        }

        // FlatList requires a stable onViewableItemsChanged callback for optimal performance.
        // Therefore, we use a ref to store values instead of adding them as dependencies.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // When unreadMarkerReportActionIndex changes we will manually call onViewableItemsChanged with previousViewableItems to recalculate
    // the state of floating button because onViewableItemsChanged on  FlatList will only be called when viewable items change.
    useEffect(() => {
        ref.current.unreadMarkerReportActionIndex = unreadMarkerReportActionIndex;

        if (ref.current.previousViewableItems.length) {
            onViewableItemsChanged({viewableItems: ref.current.previousViewableItems, changed: []});
        }
    }, [onViewableItemsChanged, unreadMarkerReportActionIndex]);

    // When actionBadgeTargetIndexes changes, recalculate visibility
    useEffect(() => {
        ref.current.actionBadgeTargetIndexes = actionBadgeTargetIndexes;
        onViewableItemsChanged({viewableItems: ref.current.previousViewableItems, changed: []});
    }, [onViewableItemsChanged, actionBadgeTargetIndexes]);

    return {
        isFloatingMessageCounterVisible,
        setIsFloatingMessageCounterVisible,
        isActionBadgeAboveViewport,
        actionBadgeTargetIndex,
        trackVerticalScrolling,
        onViewableItemsChanged,
    };
}
