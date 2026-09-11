import EmojiWithTooltip from '@components/EmojiWithTooltip';

import useThemeStyles from '@hooks/useThemeStyles';

import type {CustomRendererProps, TPhrasing, TText} from 'react-native-render-html';

import React from 'react';

function EmojiRenderer({tnode, style: styleProp}: CustomRendererProps<TText | TPhrasing>) {
    const styles = useThemeStyles();

    let style;
    if ('islarge' in tnode.attributes) {
        style = [{...styleProp, fontSize: styles.onlyEmojisText.fontSize}, styles.onlyEmojisText];
    } else if ('ismedium' in tnode.attributes) {
        style = [{...styleProp, fontSize: styles.emojisWithTextFontSize.fontSize}, styles.emojisWithTextFontSize, styles.verticalAlignTopText];
    } else {
        style = null;
    }

    return (
        <EmojiWithTooltip
            isOnSeparateLine={'oneline' in tnode.attributes}
            style={[style, styles.cursorDefault, styles.emojiDefaultStyles]}
            emojiCode={'data' in tnode ? tnode.data : ''}
            isMedium={'ismedium' in tnode.attributes}
        />
    );
}

export default EmojiRenderer;
