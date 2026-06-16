import SCREENS from '@src/SCREENS';

// Screens which are part of the 2FA setup flow - used to determine when to hide the RequireTwoFactorAuthOverlay
const SET_UP_2FA_SCREENS = new Set<string>([
    SCREENS.RIGHT_MODAL.TWO_FACTOR_AUTH,
    SCREENS.TWO_FACTOR_AUTH.DYNAMIC_ROOT,
    SCREENS.TWO_FACTOR_AUTH.DYNAMIC_VERIFY,
    SCREENS.TWO_FACTOR_AUTH.DYNAMIC_VERIFY_ACCOUNT,
    SCREENS.TWO_FACTOR_AUTH.DYNAMIC_SUCCESS,
    SCREENS.TWO_FACTOR_AUTH.SUCCESS,
    SCREENS.TWO_FACTOR_AUTH.DISABLED,
    SCREENS.TWO_FACTOR_AUTH.DISABLE,
    SCREENS.TWO_FACTOR_AUTH.REPLACE_VERIFY_OLD,
    SCREENS.TWO_FACTOR_AUTH.REPLACE_VERIFY_NEW,
]);

function isTwoFactorSetupScreen(screen: string | undefined): boolean {
    return screen ? SET_UP_2FA_SCREENS.has(screen) : false;
}

export default isTwoFactorSetupScreen;
