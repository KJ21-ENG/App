import {renderHook, waitFor} from '@testing-library/react-native';
import Onyx from 'react-native-onyx';
import useCachedAttachmentSource from '@hooks/useCachedAttachmentSource';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import waitForBatchedUpdates from '../../utils/waitForBatchedUpdates';

const ATTACHMENT_ID = 'attachment-1';
const STALE_SOURCE = 'blob:http://localhost/stale-source';
const CACHED_SOURCE = 'blob:http://localhost/cached-source';
const REMOTE_SOURCE = 'https://www.expensify.com/chat-attachments/attachment.jpg';
const SERVER_ATTACHMENT_SOURCE = '/chat-attachments/attachment.jpg';
const MOCK_BLOB = new Blob(['image-data'], {type: 'image/png'});

let mockCacheMatch: jest.Mock;
let mockCachesOpen: jest.Mock;
let mockCreateObjectURL: jest.Mock;
let mockRevokeObjectURL: jest.Mock;

function expectCacheMatchForAttachment() {
    const cacheRequest = mockCacheMatch.mock.calls[0]?.[0] as Request;
    expect(cacheRequest.url).toBe(`${window.location.origin}/${CONST.CACHE_API_KEYS.ATTACHMENTS}/${encodeURIComponent(ATTACHMENT_ID)}`);
}

beforeEach(async () => {
    await Onyx.clear();
    await waitForBatchedUpdates();

    mockCacheMatch = jest.fn().mockResolvedValue({blob: jest.fn().mockResolvedValue(MOCK_BLOB)});
    mockCachesOpen = jest.fn().mockResolvedValue({match: mockCacheMatch});
    Object.defineProperty(window, 'caches', {
        value: {
            open: mockCachesOpen,
        },
        writable: true,
        configurable: true,
    });

    mockCreateObjectURL = jest.fn().mockReturnValue(CACHED_SOURCE);
    mockRevokeObjectURL = jest.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('useCachedAttachmentSource', () => {
    it('resolves a stale local source from the attachment cache', async () => {
        const {result} = renderHook(() => useCachedAttachmentSource({attachmentID: ATTACHMENT_ID, source: STALE_SOURCE}));

        await waitFor(() => {
            expect(result.current).toEqual({
                source: CACHED_SOURCE,
                isSourceResolvedFromCache: true,
            });
        });

        expect(mockCachesOpen).toHaveBeenCalledWith(CONST.CACHE_API_KEYS.ATTACHMENTS);
        expectCacheMatchForAttachment();
        expect(mockCreateObjectURL).toHaveBeenCalledWith(MOCK_BLOB);
    });

    it('does not read the cache for remote sources', async () => {
        const {result} = renderHook(() => useCachedAttachmentSource({attachmentID: ATTACHMENT_ID, source: REMOTE_SOURCE}));

        await waitFor(() => {
            expect(result.current).toEqual({
                source: REMOTE_SOURCE,
                isSourceResolvedFromCache: false,
            });
        });

        expect(mockCachesOpen).not.toHaveBeenCalled();
    });

    it('does not read the cache for relative server attachment sources', async () => {
        const {result} = renderHook(() => useCachedAttachmentSource({attachmentID: ATTACHMENT_ID, source: SERVER_ATTACHMENT_SOURCE}));

        await waitFor(() => {
            expect(result.current).toEqual({
                source: SERVER_ATTACHMENT_SOURCE,
                isSourceResolvedFromCache: false,
            });
        });

        expect(mockCachesOpen).not.toHaveBeenCalled();
    });

    it('revokes resolved blob URLs on unmount', async () => {
        const {result, unmount} = renderHook(() => useCachedAttachmentSource({attachmentID: ATTACHMENT_ID, source: STALE_SOURCE}));

        await waitFor(() => {
            expect(result.current.source).toBe(CACHED_SOURCE);
        });

        unmount();

        expect(mockRevokeObjectURL).toHaveBeenCalledWith(CACHED_SOURCE);
    });
});
