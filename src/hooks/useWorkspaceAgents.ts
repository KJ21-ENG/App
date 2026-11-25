import {usePersonalDetails} from '@components/OnyxListItemProvider';

import {getAgentRecordAccountIDState} from '@libs/AgentUtils';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Agent, Policy} from '@src/types/onyx';

import type {OnyxCollection, OnyxEntry} from 'react-native-onyx';

import useNetwork from './useNetwork';
import useOnyx from './useOnyx';
import useWorkspaceAccountID from './useWorkspaceAccountID';
import useWorkspaceMembers from './useWorkspaceMembers';

/**
 * Hook that derives the policy's agents, including both agents owned by the policy and member agents.
 */
function useWorkspaceAgents(policy: OnyxEntry<Policy>) {
    const {isOffline} = useNetwork();
    const [allAgents] = useOnyx(ONYXKEYS.COLLECTION.AGENT);
    const [agentAccountIDMapping] = useOnyx(ONYXKEYS.OPTIMISTIC_AGENT_ACCOUNT_ID_MAPPING);
    const personalDetailsList = usePersonalDetails();
    const policyID = policy?.id;
    const workspaceAccountID = useWorkspaceAccountID(policyID);
    const workspaceMembers = useWorkspaceMembers(policy);

    const manageableWorkspaceAgents: OnyxCollection<Agent> = Object.fromEntries(
        Object.entries(allAgents ?? {}).filter(([key, agent]) => {
            if (!agent) {
                return false;
            }
            const isPendingDeletion = agent.pendingAction === CONST.RED_BRICK_ROAD_PENDING_ACTION.DELETE;
            if (isPendingDeletion && !isOffline) {
                return false;
            }
            const accountID = Number(key.slice(ONYXKEYS.COLLECTION.AGENT.length));
            // A new agent's temporary record is dropped once its real record can be listed, so the agent appears once.
            if (!getAgentRecordAccountIDState(accountID, allAgents, personalDetailsList, agentAccountIDMapping)) {
                return false;
            }
            const isAgentOwnedByWorkspace = agent.ownerAccountID === workspaceAccountID;
            const isAgentMemberOfWorkspace = !!workspaceMembers.find((member) => member.accountID === accountID);
            if (!isAgentOwnedByWorkspace && !isAgentMemberOfWorkspace) {
                return false;
            }
            return true;
        }),
    );
    const manageableWorkspaceAgentsIDs = new Set(Object.keys(manageableWorkspaceAgents).map((key) => Number(key.slice(ONYXKEYS.COLLECTION.AGENT.length))));
    // While a new agent's temporary record is listed, its real accountID can already be a workspace member. It is the same
    // agent, so it is not listed again as one the user cannot manage.
    for (const accountID of [...manageableWorkspaceAgentsIDs]) {
        const realAccountID = agentAccountIDMapping?.[accountID];
        if (typeof realAccountID === 'number') {
            manageableWorkspaceAgentsIDs.add(realAccountID);
        }
    }

    const nonManageableWorkspaceAgentsIDs: number[] = [];
    for (const {accountID, details} of workspaceMembers) {
        if (!details.isCustomAgent) {
            continue;
        }
        if (manageableWorkspaceAgentsIDs.has(accountID)) {
            continue;
        }
        nonManageableWorkspaceAgentsIDs.push(accountID);
    }

    return {
        manageableWorkspaceAgents,
        nonManageableWorkspaceAgentsIDs,
    };
}

export default useWorkspaceAgents;
