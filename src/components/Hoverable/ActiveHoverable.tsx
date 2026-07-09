import getReturnValue from '@libs/getReturnValue';
import mergeRefs from '@libs/mergeRefs';

import CONST from '@src/CONST';

import {cloneElement, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {DeviceEventEmitter} from 'react-native';

import type HoverableProps from './types';

type ActiveHoverableProps = Omit<HoverableProps, 'disabled'>;

type MouseEvents = 'onMouseEnter' | 'onMouseLeave' | 'onMouseMove';

type OnMouseEvents = Record<MouseEvents, (e: React.MouseEvent) => void>;

function ActiveHoverable({
    onHoverIn,
    onHoverOut,
    shouldHandleScroll,
    isFocused = true,
    shouldFreezeCapture,
    shouldSubscribeToNativeMouseEvents = false,
    children,
    ref,
}: ActiveHoverableProps) {
    const [isHovered, setIsHovered] = useState(false);
    const elementRef = useRef<HTMLElement | null>(null);
    const isScrollingRef = useRef(false);
    const isHoveredRef = useRef(false);
    const isVisibilityHidden = useRef(false);

    const updateIsHovered = useCallback(
        (hovered: boolean) => {
            if (shouldFreezeCapture) {
                return;
            }

            isHoveredRef.current = hovered;
            isVisibilityHidden.current = false;

            if (shouldHandleScroll && isScrollingRef.current) {
                return;
            }

            setIsHovered(hovered);

            if (hovered) {
                onHoverIn?.();
            } else {
                onHoverOut?.();
            }
        },
        [shouldHandleScroll, shouldFreezeCapture, onHoverIn, onHoverOut],
    );

    useEffect(() => {
        if (!shouldHandleScroll) {
            return;
        }

        const scrollingListener = DeviceEventEmitter.addListener(CONST.EVENTS.SCROLLING, (scrolling: boolean) => {
            isScrollingRef.current = scrolling;
            if (scrolling && isHoveredRef.current) {
                isHoveredRef.current = false;
                setIsHovered(false);
                onHoverOut?.();
            } else if (!scrolling && elementRef.current?.matches(':hover')) {
                isHoveredRef.current = true;
                setIsHovered(true);
                onHoverIn?.();
            }
        });

        return () => scrollingListener.remove();
    }, [shouldHandleScroll, onHoverIn, onHoverOut]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                isVisibilityHidden.current = true;
                setIsHovered(false);
            } else {
                isVisibilityHidden.current = false;
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    useEffect(() => {
        if (isFocused) {
            return;
        }
        setIsHovered(false);
    }, [isFocused]);

    const handleMouseEvents = useCallback(
        (type: 'enter' | 'leave') => () => {
            if (shouldFreezeCapture) {
                return;
            }

            const newHoverState = type === 'enter';
            isHoveredRef.current = newHoverState;
            isVisibilityHidden.current = false;

            updateIsHovered(newHoverState);
        },
        [shouldFreezeCapture, updateIsHovered],
    );

    useEffect(() => {
        const element = elementRef.current;
        if (!shouldSubscribeToNativeMouseEvents || !element) {
            return;
        }

        // Native mouseenter/mouseleave fire only when the pointer actually crosses this element's DOM boundary,
        // unlike the React synthetic events, which propagate through the React tree and are also triggered by
        // portalled content (e.g. popovers) rendered outside this element in the DOM.
        const onNativeMouseEnter = handleMouseEvents('enter');
        const onNativeMouseLeave = handleMouseEvents('leave');
        element.addEventListener('mouseenter', onNativeMouseEnter);
        element.addEventListener('mouseleave', onNativeMouseLeave);

        return () => {
            element.removeEventListener('mouseenter', onNativeMouseEnter);
            element.removeEventListener('mouseleave', onNativeMouseLeave);
        };
    }, [shouldSubscribeToNativeMouseEvents, handleMouseEvents]);

    const child = useMemo(() => getReturnValue(children, isHovered), [children, isHovered]);

    const {onMouseEnter, onMouseLeave} = child.props as OnMouseEvents;

    return cloneElement(child, {
        ref: mergeRefs(elementRef, ref, child.props.ref),
        ...(shouldSubscribeToNativeMouseEvents
            ? {}
            : {
                  onMouseEnter: (e: React.MouseEvent) => {
                      handleMouseEvents('enter')();
                      onMouseEnter?.(e);
                  },
                  onMouseLeave: (e: React.MouseEvent) => {
                      handleMouseEvents('leave')();
                      onMouseLeave?.(e);
                  },
              }),
    } as React.HTMLAttributes<HTMLElement>);
}

export default ActiveHoverable;
