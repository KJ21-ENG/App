import type {CartesianChartProps} from '../types';

type CartesianChartPadding = CartesianChartProps['padding'];

type NormalizeVictoryChartPaddingParams = {
    padding: CartesianChartPadding | undefined;
    xAxis: CartesianChartProps['xAxis'];
    yAxis: CartesianChartProps['yAxis'];
    isHorizontal: boolean;
};

type ExpandedPadding = {
    top: number;
    right: number;
    bottom: number;
    left: number;
};

/**
 * Normalizes the chart padding to account for native axis labels.
 *
 * For vertical charts:
 * - Keep the original parsed padding.bottom as the space where Victory's bottom annotations/legend coordinates are expected to live.
 * - Add the native independent x-axis label reserve on top of it, e.g. padding.bottom = parsedBottom + labelOffset + tickLabelLineHeight.
 * - Derive labelOffset from xAxis.labelOffset and the line height from xAxis.font metrics / configured tick-label font size, with the same fallback values used by the chart renderer.
 *
 * For horizontal charts, apply the same idea to the independent y-axis side:
 * - add the native tick-label reserve to the side that Victory Native uses for the independent axis (usually left), while preserving the original Victory padding for absolute labels/legends.
 */
function normalizeVictoryChartPadding({
    padding,
    xAxis,
    yAxis,
    isHorizontal,
}: NormalizeVictoryChartPaddingParams): ExpandedPadding {
    // 1. Expand padding to object with top, right, bottom, left. Default fallback is 50.
    let top = 50;
    let right = 50;
    let bottom = 50;
    let left = 50;

    if (typeof padding === 'number') {
        top = padding;
        right = padding;
        bottom = padding;
        left = padding;
    } else if (padding && typeof padding === 'object') {
        top = padding.top ?? 50;
        right = padding.right ?? 50;
        bottom = padding.bottom ?? 50;
        left = padding.left ?? 50;
    }

    // 2. Adjust for native independent axis labels reserve
    if (isHorizontal) {
        // Horizontal charts: yAxis is the independent axis in Victory-native context
        const yAxisList = Array.isArray(yAxis) ? yAxis : (yAxis ? [yAxis] : []);
        for (const yAxisConfig of yAxisList) {
            if (!yAxisConfig) {
                continue;
            }
            const labelOffset = yAxisConfig.labelOffset ?? 2;
            const font = yAxisConfig.font;
            const fontMetrics = font?.getMetrics();
            const tickLabelLineHeight = fontMetrics 
                ? Math.abs(fontMetrics.ascent) + fontMetrics.descent + (fontMetrics.leading ?? 0)
                : (font?.getSize() ?? 12);
            
            const reserve = labelOffset + tickLabelLineHeight;
            const axisSide = yAxisConfig.axisSide ?? 'left';
            if (axisSide === 'left') {
                left += reserve;
            } else if (axisSide === 'right') {
                right += reserve;
            }
        }
    } else {
        // Vertical charts: xAxis is the independent axis (horizontal axis at top or bottom)
        if (xAxis) {
            const labelOffset = xAxis.labelOffset ?? 2;
            const font = xAxis.font;
            const fontMetrics = font?.getMetrics();
            const tickLabelLineHeight = fontMetrics
                ? Math.abs(fontMetrics.ascent) + fontMetrics.descent + (fontMetrics.leading ?? 0)
                : (font?.getSize() ?? 12);
            
            const reserve = labelOffset + tickLabelLineHeight;
            const axisSide = xAxis.axisSide ?? 'bottom';
            if (axisSide === 'bottom') {
                bottom += reserve;
            } else if (axisSide === 'top') {
                top += reserve;
            }
        }
    }

    return {top, right, bottom, left};
}

export default normalizeVictoryChartPadding;
