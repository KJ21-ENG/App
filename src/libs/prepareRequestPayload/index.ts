import {WRITE_COMMANDS} from '@libs/API/types';
import CacheAPI from '@libs/CacheAPI';
import isFileUploadable from '@libs/isFileUploadable';
import Log from '@libs/Log';
import validateFormDataParameter from '@libs/validateFormDataParameter';
import CONST from '@src/CONST';
import type {FileObject} from '@src/types/utils/Attachment';
import type PrepareRequestPayload from './types';

const OFFLINE_ATTACHMENT_COMMANDS = new Set<string>([WRITE_COMMANDS.ADD_ATTACHMENT, WRITE_COMMANDS.ADD_TEXT_AND_ATTACHMENT]);

type FileMetadata = {
    name?: string;
    type?: string;
    uri?: string;
};

function getFileNameFromMetadata(attachmentID: string, fileMetadata: FileMetadata | undefined): string {
    if (fileMetadata?.name) {
        return fileMetadata.name;
    }

    if (fileMetadata?.uri) {
        return fileMetadata.uri.split('/').pop() ?? attachmentID;
    }

    return attachmentID;
}

async function getCachedAttachmentFile(command: string, data: Record<string, unknown>): Promise<File | undefined> {
    const attachmentID = typeof data.attachmentID === 'string' ? data.attachmentID : undefined;
    if (!attachmentID) {
        return undefined;
    }

    try {
        const cachedAttachment = await CacheAPI.get(CONST.CACHE_API_KEYS.ATTACHMENTS, attachmentID);
        if (!cachedAttachment) {
            return undefined;
        }

        const blob = await cachedAttachment.blob();
        const fileMetadata = data.file as FileMetadata | undefined;
        const fileName = getFileNameFromMetadata(attachmentID, fileMetadata);

        const file = new File([blob], fileName, {type: fileMetadata?.type ?? blob.type});

        return file;
    } catch (error) {
        Log.warn('[prepareRequestPayload] Failed to restore cached attachment file', {command, attachmentID, error});
        return undefined;
    }
}

/**
 * Prepares the request payload (body) for a given command and data.
 */
const prepareRequestPayload: PrepareRequestPayload = (command, data, initiatedOffline) => {
    const formData = new FormData();
    const shouldRestoreOfflineAttachment = initiatedOffline && OFFLINE_ATTACHMENT_COMMANDS.has(command);
    let didAppendFile = false;
    let didTryRestoringCachedAttachmentFile = false;
    let promiseChain = Promise.resolve();

    for (const key of Object.keys(data)) {
        promiseChain = promiseChain.then(async () => {
            const value = data[key];

            if (value === undefined || value === null) {
                return;
            }

            if (key === 'file' && shouldRestoreOfflineAttachment) {
                if (isFileUploadable(value as FileObject)) {
                    validateFormDataParameter(command, key, value);
                    formData.append(key, value as Blob);
                    didAppendFile = true;
                    return;
                }

                didTryRestoringCachedAttachmentFile = true;
                const cachedAttachmentFile = await getCachedAttachmentFile(command, data);
                if (cachedAttachmentFile) {
                    validateFormDataParameter(command, key, cachedAttachmentFile);
                    formData.append(key, cachedAttachmentFile);
                    didAppendFile = true;
                }
                return;
            }

            validateFormDataParameter(command, key, value);
            formData.append(key, value as string | Blob);
        });
    }

    return promiseChain.then(async () => {
        if (!shouldRestoreOfflineAttachment || didAppendFile || didTryRestoringCachedAttachmentFile) {
            return formData;
        }

        const cachedAttachmentFile = await getCachedAttachmentFile(command, data);
        if (!cachedAttachmentFile) {
            return formData;
        }

        validateFormDataParameter(command, 'file', cachedAttachmentFile);
        formData.append('file', cachedAttachmentFile);

        return formData;
    });
};

export default prepareRequestPayload;
