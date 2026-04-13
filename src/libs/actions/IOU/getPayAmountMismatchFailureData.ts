import Onyx from 'react-native-onyx';
import {getMicroSecondOnyxErrorWithTranslationKey} from '@libs/ErrorUtils';
import ONYXKEYS from '@src/ONYXKEYS';
import type {AnyOnyxUpdate} from '@src/types/onyx/Request';

function getPayAmountMismatchFailureData(baseFailureData: AnyOnyxUpdate[], iouReportID?: string, reportActionID?: string): AnyOnyxUpdate[] {
    if (typeof iouReportID !== 'string' || typeof reportActionID !== 'string') {
        return baseFailureData;
    }

    const reportActionKey = `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${iouReportID}`;
    const amountChangedError = getMicroSecondOnyxErrorWithTranslationKey('iou.error.amountChanged');
    let hasUpdatedExistingFailureEntry = false;

    const updatedFailureData = baseFailureData.map((update) => {
        if (update.onyxMethod !== Onyx.METHOD.MERGE || update.key !== reportActionKey || typeof update.value !== 'object' || !update.value) {
            return update;
        }

        const actionFailureCollection = update.value as Record<string, unknown>;
        const existingActionFailure = actionFailureCollection[reportActionID];
        if (!existingActionFailure || typeof existingActionFailure !== 'object') {
            return update;
        }

        hasUpdatedExistingFailureEntry = true;
        return {
            ...update,
            value: {
                ...actionFailureCollection,
                [reportActionID]: {
                    ...(existingActionFailure as Record<string, unknown>),
                    errors: amountChangedError,
                },
            },
        };
    });

    if (hasUpdatedExistingFailureEntry) {
        return updatedFailureData;
    }

    return [
        ...updatedFailureData,
        {
            onyxMethod: Onyx.METHOD.MERGE,
            key: reportActionKey,
            value: {
                [reportActionID]: {
                    errors: amountChangedError,
                },
            },
        },
    ];
}

export default getPayAmountMismatchFailureData;
