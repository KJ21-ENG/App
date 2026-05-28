import normalizeVictoryChartPadding from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/utils/normalizeVictoryChartPadding';
import type {CartesianChartProps} from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/types';

type Font = NonNullable<NonNullable<CartesianChartProps['xAxis']>['font']>;

const createFont = ({ascent, descent, leading, size}: {ascent?: number; descent?: number; leading?: number; size?: number}): Font =>
    ({
        getMetrics: ascent === undefined || descent === undefined ? undefined : () => ({ascent, descent, leading: leading ?? 0}),
        getSize: () => size ?? 0,
    }) as Font;

describe('normalizeVictoryChartPadding', () => {
    it('increases bottom padding for vertical charts with bottom x-axis labels', () => {
        const padding = normalizeVictoryChartPadding({
            padding: {top: 1, right: 2, bottom: 20, left: 4},
            xAxis: {
                axisSide: 'bottom',
                labelOffset: 6,
                font: createFont({ascent: -10, descent: 4, leading: 2}),
            },
            yAxis: undefined,
            isHorizontal: false,
        });

        expect(padding).toEqual({top: 1, right: 2, bottom: 42, left: 4});
    });

    it('falls back safely when vertical chart axis font config is missing', () => {
        const padding = normalizeVictoryChartPadding({
            padding: {bottom: 8},
            xAxis: undefined,
            yAxis: undefined,
            isHorizontal: false,
        });

        expect(padding).toEqual({top: 0, right: 0, bottom: 10, left: 0});
    });

    it('adjusts the independent y-axis side for horizontal charts', () => {
        const padding = normalizeVictoryChartPadding({
            padding: {top: 1, right: 5, bottom: 2, left: 20},
            xAxis: undefined,
            yAxis: [
                {
                    axisSide: 'right',
                    labelOffset: 4,
                    font: createFont({ascent: -8, descent: 3, leading: 1}),
                },
            ],
            isHorizontal: true,
        });

        expect(padding).toEqual({top: 1, right: 21, bottom: 2, left: 20});
    });

    it('expands numeric padding consistently', () => {
        const padding = normalizeVictoryChartPadding({
            padding: 10,
            xAxis: {
                axisSide: 'bottom',
                labelOffset: 3,
                font: createFont({size: 12}),
            },
            yAxis: undefined,
            isHorizontal: false,
        });

        expect(padding).toEqual({top: 10, right: 10, bottom: 25, left: 10});
    });
});
