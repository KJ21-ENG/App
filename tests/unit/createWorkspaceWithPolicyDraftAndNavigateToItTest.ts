import Navigation from '@libs/Navigation/Navigation';
import willRouteNavigateToRHP from '@libs/Navigation/helpers/willRouteNavigateToRHP';
import {createWorkspaceWithPolicyDraftAndNavigateToIt} from '@libs/actions/App';
import ROUTES from '@src/ROUTES';

jest.mock('@libs/Navigation/Navigation', () => ({
    dismissModal: jest.fn(),
    goBack: jest.fn(),
    isNavigationReady: jest.fn(() => Promise.resolve()),
    isTopmostRouteModalScreen: jest.fn(() => true),
    navigate: jest.fn(),
    revealRouteBeforeDismissingModal: jest.fn(),
    navigationRef: {
        getRootState: jest.fn(() => ({routes: []})),
        isReady: jest.fn(() => true),
    },
}));

jest.mock('@libs/Navigation/helpers/willRouteNavigateToRHP', () => jest.fn(() => false));

jest.mock('@libs/actions/Policy/Policy', () => ({
    createDraftInitialWorkspace: jest.fn(),
    createWorkspace: jest.fn(),
    generateDefaultWorkspaceName: jest.fn(() => 'Workspace'),
    generatePolicyID: jest.fn(() => 'generated-policy-id'),
}));

const baseParams = {
    introSelected: undefined,
    policyName: 'Test workspace',
    policyID: 'policy-123',
    currency: 'USD',
    activePolicy: undefined,
    currentUserAccountIDParam: 1,
    currentUserEmailParam: 'user@example.com',
    isSelfTourViewed: false,
    betas: undefined,
    hasActiveAdminPolicies: false,
};

const flushNavigationReady = () => Promise.resolve();

describe('createWorkspaceWithPolicyDraftAndNavigateToIt', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (Navigation.isTopmostRouteModalScreen as jest.Mock).mockReturnValue(true);
        (willRouteNavigateToRHP as jest.Mock).mockReturnValue(false);
    });

    it('dismisses the modal without revealing a fullscreen route when the destination was preinserted', async () => {
        const routeToNavigate = ROUTES.WORKSPACE_INITIAL.getRoute('policy-123');

        createWorkspaceWithPolicyDraftAndNavigateToIt({
            ...baseParams,
            routeToNavigateAfterCreate: routeToNavigate,
            shouldDismissPreInsertedFullscreenRoute: true,
        });
        await flushNavigationReady();

        expect(Navigation.dismissModal).toHaveBeenCalledTimes(1);
        expect(Navigation.revealRouteBeforeDismissingModal).not.toHaveBeenCalled();
        expect(Navigation.navigate).not.toHaveBeenCalled();
    });

    it('keeps using revealRouteBeforeDismissingModal when the destination was not preinserted', async () => {
        const routeToNavigate = ROUTES.WORKSPACE_INITIAL.getRoute('policy-123');

        createWorkspaceWithPolicyDraftAndNavigateToIt({
            ...baseParams,
            routeToNavigateAfterCreate: routeToNavigate,
            shouldDismissPreInsertedFullscreenRoute: false,
        });
        await flushNavigationReady();

        expect(Navigation.revealRouteBeforeDismissingModal).toHaveBeenCalledWith(routeToNavigate);
        expect(Navigation.dismissModal).not.toHaveBeenCalled();
    });

    it('preserves RHP-target handling even when the fullscreen preinsert flag is true', async () => {
        (willRouteNavigateToRHP as jest.Mock).mockReturnValue(true);

        createWorkspaceWithPolicyDraftAndNavigateToIt({
            ...baseParams,
            routeToNavigateAfterCreate: ROUTES.WORKSPACE_CONFIRMATION_SUCCESS,
            shouldDismissPreInsertedFullscreenRoute: true,
        });
        await flushNavigationReady();

        expect(Navigation.dismissModal).toHaveBeenCalledWith({afterTransition: expect.any(Function)});
        expect(Navigation.revealRouteBeforeDismissingModal).not.toHaveBeenCalled();
    });
});
