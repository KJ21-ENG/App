import React from 'react';
import FocusableMenuItem from '@components/FocusableMenuItem';
import type {MenuItemProps} from '@components/MenuItem';
import CONST from '@src/CONST';
import type {FABMenuItemPressOptions} from './FABMenuContext';
import useFABMenuItem from './useFABMenuItem';

type FABFocusableMenuItemProps = Omit<MenuItemProps, 'focused' | 'onFocus' | 'wrapperStyle' | 'shouldCheckActionAllowedOnPress' | 'role' | 'onPress'> & {
    itemId: string;
    isVisible?: boolean;
    onPress?: () => void;
} & FABMenuItemPressOptions;

function FABFocusableMenuItem({itemId, isVisible = true, onPress, shouldCallAfterModalHide, shouldAvoidSafariException, ...props}: FABFocusableMenuItemProps) {
    const {itemIndex, isFocused, wrapperStyle, setFocusedIndex, onItemPress} = useFABMenuItem(itemId, isVisible);

    if (!isVisible) {
        return null;
    }

    return (
        <FocusableMenuItem
            // FABFocusableMenuItemProps is a strict subset of MenuItemProps — spreading forwards all remaining props safely

            {...(props as MenuItemProps)}
            focused={isFocused}
            onFocus={() => setFocusedIndex(itemIndex)}
            wrapperStyle={wrapperStyle}
            shouldCheckActionAllowedOnPress={false}
            role={CONST.ROLE.BUTTON}
            onPress={onPress ? () => onItemPress(onPress, {shouldCallAfterModalHide, shouldAvoidSafariException}) : undefined}
        />
    );
}

export default FABFocusableMenuItem;
