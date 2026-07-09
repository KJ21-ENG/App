import {useSearchSidebarCollapse} from '@components/Navigation/SearchSidebarCollapseStore';
import type {PopoverMenuItem} from '@components/PopoverMenu';
import ThreeDotsMenu from '@components/ThreeDotsMenu';

import {MENU_CLOSE_DELAY_MS} from '@hooks/useShareSavedSearch';
import useThemeStyles from '@hooks/useThemeStyles';

import CONST from '@src/CONST';

import React, {useEffect, useMemo, useRef} from 'react';
import {View} from 'react-native';

type ThreeDotsMenuHandle = {hidePopoverMenu: () => void; isPopupMenuVisible: boolean};

type SavedSearchItemThreeDotMenuProps = {
    menuItems: PopoverMenuItem[];
    isDisabledItem: boolean;
    hideProductTrainingTooltip?: () => void;
    renderTooltipContent: () => React.JSX.Element;
    shouldRenderTooltip: boolean;
    isCopied?: boolean;

    /** Called when the overflow popover is removed by an overflow action (Share copied timeout, Rename, Delete) so the parent can clear the stale row highlight */
    onOverflowMenuHide?: () => void;
};

function SavedSearchItemThreeDotMenu({menuItems, isDisabledItem, hideProductTrainingTooltip, renderTooltipContent, shouldRenderTooltip, isCopied, onOverflowMenuHide}: SavedSearchItemThreeDotMenuProps) {
    const styles = useThemeStyles();
    const {endPeek} = useSearchSidebarCollapse();
    const threeDotsMenuRef = useRef<ThreeDotsMenuHandle | null>(null);

    const menuItemsWithPeekCleanup = useMemo(
        () =>
            menuItems.map((item) => {
                if (item.shouldCloseModalOnSelect === false) {
                    return item;
                }

                return {
                    ...item,
                    onSelected: () => {
                        endPeek();
                        item.onSelected?.();
                        // The overflow popover closes on select while the pointer can still be over the row, so remount the row to clear its stale hover highlight.
                        onOverflowMenuHide?.();
                    },
                };
            }),
        [endPeek, menuItems, onOverflowMenuHide],
    );

    useEffect(() => {
        if (!isCopied) {
            return;
        }
        const timer = setTimeout(() => {
            // Only clear the row highlight when this timeout actually removes an open popover, so the follow-up remount doesn't re-trigger the reset.
            const wasPopoverVisible = threeDotsMenuRef.current?.isPopupMenuVisible ?? false;
            threeDotsMenuRef.current?.hidePopoverMenu();
            if (wasPopoverVisible) {
                onOverflowMenuHide?.();
            }
        }, MENU_CLOSE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [isCopied, onOverflowMenuHide]);

    return (
        <View style={[styles.searchTypeMenuAccessoryBox, isDisabledItem && styles.pointerEventsNone]}>
            <ThreeDotsMenu
                shouldSelfPosition
                menuItems={menuItemsWithPeekCleanup}
                renderProductTrainingTooltipContent={renderTooltipContent}
                shouldShowProductTrainingTooltip={shouldRenderTooltip}
                anchorAlignment={{
                    horizontal: CONST.MODAL.ANCHOR_ORIGIN_HORIZONTAL.LEFT,
                    vertical: CONST.MODAL.ANCHOR_ORIGIN_VERTICAL.TOP,
                }}
                iconStyles={styles.wAuto}
                hideProductTrainingTooltip={hideProductTrainingTooltip}
                sentryLabel={CONST.SENTRY_LABEL.SEARCH.SAVED_SEARCH_THREE_DOT_MENU}
                threeDotsMenuRef={threeDotsMenuRef}
            />
        </View>
    );
}

export default SavedSearchItemThreeDotMenu;
