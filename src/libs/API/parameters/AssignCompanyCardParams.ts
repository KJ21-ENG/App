import type {CardFeedWithNumber} from '@src/types/onyx/CardFeeds';

type AssignCompanyCardParams = {
    domainAccountID?: number;
    policyID: string;
    bankName: CardFeedWithNumber | undefined;
    cardName: string;
    encryptedCardNumber: string;
    email: string;
    startDate: string;
    assignmentDate: string;
    reportActionID: string;
};

export default AssignCompanyCardParams;
