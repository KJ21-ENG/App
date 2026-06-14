import {useEffect, useState} from 'react';
import useOnyx from '@hooks/useOnyx';
import {getCachedAttachment} from '@userActions/Attachment';
import {isLocalFile} from '@libs/fileDownload/FileUtils';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';

type UseCachedAttachmentSourceParams = {
    attachmentID?: string;
    source?: string;
};

type UseCachedAttachmentSourceResult = {
    source: string;
    isSourceResolvedFromCache: boolean;
};

function isCacheableAttachmentSource(source?: string): source is string {
    return !!source && isLocalFile(source) && !source.startsWith('/chat-attachments');
}

function useCachedAttachmentSource({attachmentID, source = ''}: UseCachedAttachmentSourceParams): UseCachedAttachmentSourceResult {
    const [attachment] = useOnyx(`${ONYXKEYS.COLLECTION.ATTACHMENT}${attachmentID ?? CONST.DEFAULT_NUMBER_ID}`, {canBeMissing: true});
    const [cachedSource, setCachedSource] = useState<string>();

    useEffect(() => {
        let isSubscribed = true;
        setCachedSource(undefined);

        const isCacheableSource = isCacheableAttachmentSource(source);

        if (!attachmentID || !isCacheableSource) {
            return () => {
                isSubscribed = false;
            };
        }

        getCachedAttachment({attachmentID, attachment, currentSource: source})
            .then((resolvedSource) => {
                if (!isSubscribed || resolvedSource === source) {
                    return;
                }

                setCachedSource(resolvedSource);
            })
            .catch(() => undefined);

        return () => {
            isSubscribed = false;
        };
    }, [attachment, attachmentID, source]);

    useEffect(() => {
        return () => {
            if (!cachedSource?.startsWith('blob:')) {
                return;
            }

            URL.revokeObjectURL(cachedSource);
        };
    }, [cachedSource]);

    return {
        source: cachedSource ?? source,
        isSourceResolvedFromCache: !!cachedSource && cachedSource !== source,
    };
}

export default useCachedAttachmentSource;
export {isCacheableAttachmentSource};
