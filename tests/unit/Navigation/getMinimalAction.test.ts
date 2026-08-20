import getMinimalAction from '@libs/Navigation/helpers/linkTo/getMinimalAction';

import NAVIGATORS from '@src/NAVIGATORS';
import SCREENS from '@src/SCREENS';

import type {NavigationAction, NavigationState} from '@react-navigation/native';

const POLICY_A = 'policy-a';
const POLICY_B = 'policy-b';

function buildWorkspaceState(sidebarPolicyID: string): NavigationState {
    return {
        index: 0,
        routes: [
            {
                key: 'tab-route',
                name: NAVIGATORS.TAB_NAVIGATOR,
                state: {
                    key: 'tab-state',
                    index: 0,
                    routes: [
                        {
                            key: 'workspace-route',
                            name: NAVIGATORS.WORKSPACE_NAVIGATOR,
                            state: {
                                key: 'workspace-state',
                                index: 0,
                                routes: [
                                    {
                                        key: 'split-route',
                                        name: NAVIGATORS.WORKSPACE_SPLIT_NAVIGATOR,
                                        state: {
                                            key: 'split-state',
                                            index: 1,
                                            routes: [
                                                {key: 'sidebar-route', name: SCREENS.WORKSPACE.INITIAL, params: {policyID: sidebarPolicyID}},
                                                {key: 'central-route', name: SCREENS.WORKSPACE.PROFILE, params: {policyID: sidebarPolicyID}},
                                            ],
                                        } as NavigationState,
                                    },
                                ],
                            } as NavigationState,
                        },
                    ],
                } as NavigationState,
            },
        ],
    } as NavigationState;
}

function buildWorkspaceAction(policyID: string): NavigationAction {
    return {
        type: 'NAVIGATE',
        payload: {
            name: NAVIGATORS.TAB_NAVIGATOR,
            params: {
                screen: NAVIGATORS.WORKSPACE_NAVIGATOR,
                params: {
                    screen: NAVIGATORS.WORKSPACE_SPLIT_NAVIGATOR,
                    params: {
                        screen: SCREENS.WORKSPACE.MORE_FEATURES,
                        params: {policyID},
                    },
                },
            },
        },
    } as NavigationAction;
}

describe('getMinimalAction', () => {
    it('targets the existing split navigator when the workspace does not change', () => {
        const result = getMinimalAction(buildWorkspaceAction(POLICY_A), buildWorkspaceState(POLICY_A));

        expect(result.action).toMatchObject({
            type: 'NAVIGATE',
            target: 'split-state',
            payload: {name: SCREENS.WORKSPACE.MORE_FEATURES, params: {policyID: POLICY_A}},
        });
    });

    it('pushes a new split navigator when the workspace changes', () => {
        const result = getMinimalAction(buildWorkspaceAction(POLICY_A), buildWorkspaceState(POLICY_B));

        expect(result.action).toMatchObject({
            type: 'PUSH',
            target: 'workspace-state',
            payload: {
                name: NAVIGATORS.WORKSPACE_SPLIT_NAVIGATOR,
                params: {
                    screen: SCREENS.WORKSPACE.MORE_FEATURES,
                    params: {policyID: POLICY_A},
                },
            },
        });
    });
});
