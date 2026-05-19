import ONYXKEYS from '@src/ONYXKEYS';

type UnknownObject = Record<string, unknown>;
type OnyxUpdateLike = {
    key?: unknown;
    value?: unknown;
};

function isObject(value: unknown): value is UnknownObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSkinTones(skinTones: unknown) {
    if (!Array.isArray(skinTones)) {
        return skinTones;
    }

    return Object.fromEntries(Object.entries(skinTones).filter(([, createdAt]) => createdAt !== undefined));
}

function normalizeReportActionReactionValue(value: unknown) {
    if (!isObject(value)) {
        return value;
    }

    let didChange = false;
    const normalizedValue = {...value};

    for (const [emojiName, reaction] of Object.entries(value)) {
        if (!isObject(reaction)) {
            continue;
        }

        const {users} = reaction;
        if (!isObject(users)) {
            continue;
        }

        let normalizedUsers: UnknownObject | undefined;
        for (const [accountID, userReaction] of Object.entries(users)) {
            if (!isObject(userReaction)) {
                continue;
            }

            const normalizedSkinTones = normalizeSkinTones(userReaction.skinTones);
            if (normalizedSkinTones === userReaction.skinTones) {
                continue;
            }

            normalizedUsers ??= {...users};
            normalizedUsers[accountID] = {
                ...userReaction,
                skinTones: normalizedSkinTones,
            };
            didChange = true;
        }

        if (!normalizedUsers) {
            continue;
        }

        normalizedValue[emojiName] = {
            ...reaction,
            users: normalizedUsers,
        };
    }

    return didChange ? normalizedValue : value;
}

function normalizeReportActionReactionOnyxUpdates<TUpdate extends OnyxUpdateLike>(updates: TUpdate[] | undefined): TUpdate[] | undefined {
    if (!updates) {
        return updates;
    }

    let didChange = false;
    const normalizedUpdates = updates.map((update) => {
        if (typeof update.key !== 'string' || !update.key.startsWith(ONYXKEYS.COLLECTION.REPORT_ACTIONS_REACTIONS)) {
            return update;
        }

        const normalizedValue = normalizeReportActionReactionValue(update.value);
        if (normalizedValue === update.value) {
            return update;
        }

        didChange = true;
        return {
            ...update,
            value: normalizedValue,
        } as TUpdate;
    });

    return didChange ? normalizedUpdates : updates;
}

export {normalizeReportActionReactionOnyxUpdates};
