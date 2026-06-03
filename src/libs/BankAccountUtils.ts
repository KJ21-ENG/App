import {Str} from 'expensify-common';
import type {OnyxEntry} from 'react-native-onyx';
import type {ValueOf} from 'type-fest';
import CONST from '@src/CONST';
import type {TranslationPaths} from '@src/languages/types';
import type * as OnyxTypes from '@src/types/onyx';
import type AccountData from '@src/types/onyx/AccountData';

type BankAccountConnectionStatus = {
    labelKey: TranslationPaths;
    tone: 'default' | 'success' | 'danger';
    messageKey?: TranslationPaths;
    actionKey?: TranslationPaths;
    tooltipKey?: TranslationPaths;
    brickRoadIndicator?: ValueOf<typeof CONST.BRICK_ROAD_INDICATOR_STATUS>;
};

function getDefaultCompanyWebsite(session: OnyxEntry<OnyxTypes.Session>, account: OnyxEntry<OnyxTypes.Account>, shouldShowPublicDomain = false): string {
    return account?.isFromPublicDomain && !shouldShowPublicDomain ? '' : `https://www.${Str.extractEmailDomain(session?.email ?? '')}`;
}

function getLastFourDigits(bankAccountNumber: string): string {
    return bankAccountNumber ? bankAccountNumber.slice(-4) : '';
}

function isBankAccountPartiallySetup(state: string | undefined) {
    return state === CONST.BANK_ACCOUNT.STATE.SETUP || state === CONST.BANK_ACCOUNT.STATE.VERIFYING || state === CONST.BANK_ACCOUNT.STATE.PENDING;
}

function getBankAccountConnectionStatus(state: string | undefined): BankAccountConnectionStatus | undefined {
    switch (state) {
        case CONST.BANK_ACCOUNT.STATE.OPEN:
            return {
                labelKey: 'walletPage.bankAccountStatus.active',
                tone: 'success',
            };
        case CONST.BANK_ACCOUNT.STATE.SETUP:
        case undefined:
            return {
                labelKey: 'walletPage.bankAccountStatus.incomplete',
                messageKey: 'walletPage.bankAccountStatus.finishAddingBankAccount',
                actionKey: 'walletPage.bankAccountStatus.finish',
                tone: 'danger',
                brickRoadIndicator: CONST.BRICK_ROAD_INDICATOR_STATUS.ERROR,
            };
        case CONST.BANK_ACCOUNT.STATE.PENDING:
            return {
                labelKey: 'walletPage.bankAccountStatus.pending',
                messageKey: 'walletPage.bankAccountStatus.confirmTestTransactions',
                actionKey: 'common.confirm',
                tone: 'danger',
                brickRoadIndicator: CONST.BRICK_ROAD_INDICATOR_STATUS.ERROR,
            };
        case CONST.BANK_ACCOUNT.STATE.VERIFYING:
            return {
                labelKey: 'walletPage.bankAccountStatus.verifying',
                tooltipKey: 'walletPage.bankAccountStatus.reviewingDocumentation',
                tone: 'default',
            };
        case CONST.BANK_ACCOUNT.STATE.LOCKED:
            return {
                labelKey: 'common.locked',
                messageKey: 'walletPage.bankAccountStatus.accountRequiresAttention',
                actionKey: 'walletPage.bankAccountStatus.unlock',
                tone: 'danger',
                brickRoadIndicator: CONST.BRICK_ROAD_INDICATOR_STATUS.ERROR,
            };
        default:
            return undefined;
    }
}

function doesPolicyHavePartiallySetupBankAccount(bankAccountList: OnyxEntry<OnyxTypes.BankAccountList>, policyID: string) {
    if (!bankAccountList) {
        return false;
    }

    const bankAccounts = Object.values(bankAccountList);
    const matchingBankAccount = bankAccounts.find((bankAccount) => bankAccount.accountData?.policyIDs?.includes(policyID));

    return isBankAccountPartiallySetup(matchingBankAccount?.accountData?.state);
}

function hasPartiallySetupBankAccount(bankAccountList: OnyxEntry<OnyxTypes.BankAccountList>): boolean {
    return Object.values(bankAccountList ?? {}).some((bankAccount) => isBankAccountPartiallySetup(bankAccount?.accountData?.state));
}

const PERSONAL_INFO_STEP = {
    NAME: 1,
    ADDRESS: 2,
    PHONE: 3,
} as const;

type AdditionalData = AccountData['additionalData'];

function hasOwnerName(additionalData: AdditionalData): boolean {
    // OldDot stores firstName/lastName, NewDot stores legalFirstName/legalLastName — both are valid.
    return (!!additionalData?.firstName && !!additionalData?.lastName) || (!!additionalData?.legalFirstName && !!additionalData?.legalLastName);
}

function hasOwnerAddress(additionalData: AdditionalData): boolean {
    return !!additionalData?.addressStreet && !!additionalData?.addressCity && !!additionalData?.addressState && !!additionalData?.addressZipCode;
}

function hasOwnerPhone(additionalData: AdditionalData): boolean {
    return !!additionalData?.companyPhone;
}

function isPersonalBankAccountMissingInfo(accountData: AccountData | undefined): boolean {
    if (accountData?.type !== CONST.BANK_ACCOUNT.TYPE.PERSONAL) {
        return false;
    }

    if (accountData.state !== CONST.BANK_ACCOUNT.STATE.OPEN) {
        return false;
    }

    // Defaults to US when absent — legacy US accounts may omit country, matching BankAccount.getCountry().
    const country = accountData.additionalData?.country ?? CONST.COUNTRY.US;
    if (country !== CONST.COUNTRY.US) {
        return false;
    }

    const {additionalData} = accountData;

    return !hasOwnerName(additionalData) || !hasOwnerAddress(additionalData) || !hasOwnerPhone(additionalData);
}

function getCompletedStepsForBankAccount(bankAccountList: OnyxEntry<OnyxTypes.BankAccountList>, bankAccountID: number): number[] {
    const bankAccount = bankAccountList?.[String(bankAccountID)];
    if (!bankAccount) {
        return [];
    }

    const {additionalData} = bankAccount.accountData ?? {};
    const completedSteps: number[] = [];

    if (hasOwnerName(additionalData)) {
        completedSteps.push(PERSONAL_INFO_STEP.NAME);
    }
    if (hasOwnerAddress(additionalData)) {
        completedSteps.push(PERSONAL_INFO_STEP.ADDRESS);
    }
    if (hasOwnerPhone(additionalData)) {
        completedSteps.push(PERSONAL_INFO_STEP.PHONE);
    }

    return completedSteps;
}

function hasPersonalBankAccountMissingInfo(bankAccountList: OnyxEntry<OnyxTypes.BankAccountList>): boolean {
    return Object.values(bankAccountList ?? {}).some((bankAccount) => isPersonalBankAccountMissingInfo(bankAccount?.accountData));
}

export {
    getDefaultCompanyWebsite,
    getBankAccountConnectionStatus,
    getLastFourDigits,
    hasPartiallySetupBankAccount,
    hasPersonalBankAccountMissingInfo,
    isBankAccountPartiallySetup,
    doesPolicyHavePartiallySetupBankAccount,
    isPersonalBankAccountMissingInfo,
    getCompletedStepsForBankAccount,
    PERSONAL_INFO_STEP,
};
