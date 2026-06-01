import {circularDeepEqual} from 'fast-equals';
import React, {useEffect, useState, useTransition} from 'react';
import Modal from '@components/Modal';
import {isInternalPopstateInProgress} from '@components/Modal/internalPopstateGuard';
import useResponsiveLayout from '@hooks/useResponsiveLayout';
import CONST from '@src/CONST';
import PopoverWithMeasuredContentBase from './PopoverWithMeasuredContentBase';
import type PopoverWithMeasuredContentProps from './types';

/**
 * Logic for PopoverWithMeasuredContent is in PopoverWithMeasuredContentBase.
 * This component is a perf optimization, it return BOTTOM_DOCKED early, for small screens avoiding Popover measurement logic calculations.
 * It defers rendering of PopoverWithMeasuredContentBase to idle time to avoid blocking more priority UI updates with measurements.
 */
function PopoverWithMeasuredContent({shouldWrapModalChildrenInScrollViewIfBottomDockedInLandscapeMode, ...props}: PopoverWithMeasuredContentProps) {
    // eslint-disable-next-line rulesdir/prefer-shouldUseNarrowLayout-instead-of-isSmallScreenWidth
    const {isSmallScreenWidth} = useResponsiveLayout();
    const {isVisible, onClose, shouldCloseWhenBrowserNavigationChanged = true} = props;

    const [, startTransition] = useTransition();
    const [isReadyToCalculatePosition, setIsReadyToCalculatePosition] = useState(false);

    useEffect(() => {
        if (!isSmallScreenWidth || !shouldCloseWhenBrowserNavigationChanged) {
            return;
        }

        const listener = () => {
            if (!isVisible) {
                return;
            }

            if (isInternalPopstateInProgress()) {
                return;
            }

            onClose?.();
        };

        window.addEventListener('popstate', listener);
        return () => {
            window.removeEventListener('popstate', listener);
        };
    }, [isSmallScreenWidth, isVisible, onClose, shouldCloseWhenBrowserNavigationChanged]);

    useEffect(() => {
        // Only defer rendering for large screens, pre-calculation is not needed for small screens
        if (isSmallScreenWidth) {
            return;
        }
        startTransition(() => {
            setIsReadyToCalculatePosition(true);
        });
    }, [isSmallScreenWidth]);

    if (isSmallScreenWidth) {
        return (
            <Modal
                {...props}
                type={CONST.MODAL.MODAL_TYPE.BOTTOM_DOCKED}
                animationIn="slideInUp"
                animationOut="slideOutDown"
                shouldWrapModalChildrenInScrollViewIfBottomDockedInLandscapeMode={shouldWrapModalChildrenInScrollViewIfBottomDockedInLandscapeMode}
            />
        );
    }

    if (!isReadyToCalculatePosition) {
        return null;
    }

    return <PopoverWithMeasuredContentBase {...props} />;
}

PopoverWithMeasuredContent.displayName = 'PopoverWithMeasuredContent';

export default React.memo(PopoverWithMeasuredContent, (prevProps, nextProps) => {
    if (prevProps.isVisible === nextProps.isVisible && nextProps.isVisible === false) {
        return true;
    }
    return circularDeepEqual(prevProps, nextProps);
});
