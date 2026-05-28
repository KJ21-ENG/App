import type {CartesianChartProps} from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/types';

type Padding = CartesianChartProps['padding'];
type ExpandedPadding = Exclude<Padding, number | undefined>;
type XAxis = CartesianChartProps['xAxis'];
type YAxis = NonNullable<CartesianChartProps['yAxis']>[number];
type Axis = XAxis | YAxis;

const X_AXIS_LABEL_OFFSET_FALLBACK = 2;
const Y_AXIS_LABEL_OFFSET_FALLBACK = 4;

function getFiniteNumber(value: number | undefined, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function expandPadding(padding: Padding): Required<ExpandedPadding> {
    if (typeof padding === 'number') {
        return {
            top: padding,
            right: padding,
            bottom: padding,
            left: padding,
        };
    }

    return {
        top: getFiniteNumber(padding?.top),
        right: getFiniteNumber(padding?.right),
        bottom: getFiniteNumber(padding?.bottom),
        left: getFiniteNumber(padding?.left),
    };
}

function getAxisTickLabelLineHeight(axis: Axis | undefined): number {
    const metrics = axis?.font?.getMetrics?.();
    if (metrics) {
        return Math.abs(metrics.ascent) + Math.abs(metrics.descent) + getFiniteNumber(metrics.leading);
    }

    return getFiniteNumber(axis?.font?.getSize?.());
}

function getAxisTickLabelReserve(axis: Axis | undefined, labelOffsetFallback: number): number {
    return getFiniteNumber(axis?.labelOffset, labelOffsetFallback) + getAxisTickLabelLineHeight(axis);
}

function normalizeVictoryChartPadding({
    padding,
    xAxis,
    yAxis,
    isHorizontal,
}: {
    padding: Padding;
    xAxis: XAxis;
    yAxis: CartesianChartProps['yAxis'];
    isHorizontal: boolean | undefined;
}): Padding {
    const normalizedPadding = expandPadding(padding);

    if (isHorizontal) {
        const independentAxis = yAxis?.at(0);
        const reserve = getAxisTickLabelReserve(independentAxis, Y_AXIS_LABEL_OFFSET_FALLBACK);

        if (independentAxis?.axisSide === 'right') {
            normalizedPadding.right += reserve;
        } else {
            normalizedPadding.left += reserve;
        }

        return normalizedPadding;
    }

    const reserve = getAxisTickLabelReserve(xAxis, X_AXIS_LABEL_OFFSET_FALLBACK);

    if (xAxis?.axisSide === 'top') {
        normalizedPadding.top += reserve;
    } else {
        normalizedPadding.bottom += reserve;
    }

    return normalizedPadding;
}

export default normalizeVictoryChartPadding;
