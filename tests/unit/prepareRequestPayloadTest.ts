import prepareRequestPayload from '@libs/prepareRequestPayload';
import CONST from '@src/CONST';

const ATTACHMENT_ID = 'attachment-1';
const MOCK_BLOB = new Blob(['image-data'], {type: 'image/png'});

let mockCacheMatch: jest.Mock;
let mockCachesOpen: jest.Mock;

function expectCacheMatchForAttachment() {
    const cacheRequest = mockCacheMatch.mock.calls[0]?.[0] as Request;
    expect(cacheRequest.url).toBe(`${window.location.origin}/${CONST.CACHE_API_KEYS.ATTACHMENTS}/${encodeURIComponent(ATTACHMENT_ID)}`);
}

beforeEach(() => {
    mockCacheMatch = jest.fn().mockResolvedValue({blob: jest.fn().mockResolvedValue(MOCK_BLOB)});
    mockCachesOpen = jest.fn().mockResolvedValue({match: mockCacheMatch});
    Object.defineProperty(window, 'caches', {
        value: {
            open: mockCachesOpen,
        },
        writable: true,
        configurable: true,
    });
});

describe('prepareRequestPayload', () => {
    it('should append string values to FormData', async () => {
        const formData = await prepareRequestPayload('TestCommand', {authToken: 'abc123', email: 'test@example.com'}, false);

        expect(formData.get('authToken')).toBe('abc123');
        expect(formData.get('email')).toBe('test@example.com');
    });

    it('should omit null values from FormData instead of coercing them to the string "null"', async () => {
        const formData = await prepareRequestPayload('TestCommand', {authToken: null, email: null, referer: 'ecash'}, false);

        expect(formData.has('authToken')).toBe(false);
        expect(formData.has('email')).toBe(false);
        expect(formData.get('referer')).toBe('ecash');
    });

    it('should omit undefined values from FormData', async () => {
        const formData = await prepareRequestPayload('TestCommand', {authToken: undefined, platform: 'web'}, false);

        expect(formData.has('authToken')).toBe(false);
        expect(formData.get('platform')).toBe('web');
    });

    it('should include falsy non-null/undefined values (0, false, empty string)', async () => {
        const formData = await prepareRequestPayload('TestCommand', {count: 0, flag: false, label: ''}, false);

        expect(formData.get('count')).toBe('0');
        expect(formData.get('flag')).toBe('false');
        expect(formData.get('label')).toBe('');
    });

    it('should return an empty FormData for an empty data object', async () => {
        const formData = await prepareRequestPayload('TestCommand', {}, false);
        const entries = Array.from(formData.entries());

        expect(entries).toHaveLength(0);
    });

    it('should restore an offline attachment file from cache when the persisted file is no longer uploadable', async () => {
        const formData = await prepareRequestPayload(
            'AddAttachment',
            {
                attachmentID: ATTACHMENT_ID,
                file: {
                    name: 'offline-image.png',
                    type: 'image/png',
                    uri: 'blob:http://localhost/stale-source',
                },
            },
            true,
        );

        const restoredFile = formData.get('file');

        expect(restoredFile).toBeInstanceOf(File);
        expect((restoredFile as File).name).toBe('offline-image.png');
        expect((restoredFile as File).type).toBe('image/png');
        await expect((restoredFile as File).text()).resolves.toBe('image-data');
        expect(mockCachesOpen).toHaveBeenCalledWith(CONST.CACHE_API_KEYS.ATTACHMENTS);
        expectCacheMatchForAttachment();
    });

    it('should restore an offline attachment file from cache when the file key is missing after reload', async () => {
        const formData = await prepareRequestPayload('AddTextAndAttachment', {attachmentID: ATTACHMENT_ID, reportComment: 'hello'}, true);
        const restoredFile = formData.get('file');

        expect(restoredFile).toBeInstanceOf(File);
        expect((restoredFile as File).name).toBe(ATTACHMENT_ID);
    });

    it('should leave live uploadable files unchanged', async () => {
        const liveFile = new File(['live-image-data'], 'live-image.png', {type: 'image/png'});
        const formData = await prepareRequestPayload('AddAttachment', {attachmentID: ATTACHMENT_ID, file: liveFile}, true);

        expect(formData.get('file')).toBe(liveFile);
        expect(mockCachesOpen).not.toHaveBeenCalled();
    });

    it('should not restore cached files for unrelated offline commands', async () => {
        const formData = await prepareRequestPayload('SomeCommand', {attachmentID: ATTACHMENT_ID, reportComment: 'hello'}, true);

        expect(formData.has('file')).toBe(false);
        expect(mockCachesOpen).not.toHaveBeenCalled();
    });
});
