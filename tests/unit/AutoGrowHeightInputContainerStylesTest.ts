import getAutoGrowHeightInputContainerStyles from '@src/styles/utils/autoGrowHeightInputContainerStyles';
import getAndroidAutoGrowHeightInputContainerStyles from '@src/styles/utils/autoGrowHeightInputContainerStyles/index.android';
import variables from '@src/styles/variables';

describe('getAutoGrowHeightInputContainerStyles', () => {
    it('starts the Android slot at one input row and lets it grow', () => {
        // Given the Android slot style, used inside a form scroll view that sizes a `flex: 1` slot from its content
        // When the style is read
        const style = getAndroidAutoGrowHeightInputContainerStyles();

        // Then it starts from one input row instead of the input's content, so a tall input cannot make the form taller,
        // and it can still grow into free space but never shrink below that row on a short screen
        expect(style).toEqual({flexGrow: 1, height: variables.componentSizeLarge});
        expect(style).not.toHaveProperty('flex');
        expect(style).not.toHaveProperty('flexShrink');
    });

    it('keeps the slot filling its form on other platforms', () => {
        // Given the default slot style, used where the form either bounds its content (web) or keeps intrinsic scrolling (iOS)
        // When the style is read
        const style = getAutoGrowHeightInputContainerStyles();

        // Then the slot fills the space the form gives it, unchanged from before
        expect(style).toEqual({flex: 1});
    });
});
