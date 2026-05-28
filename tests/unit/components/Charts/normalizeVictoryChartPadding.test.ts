import normalizeVictoryChartPadding from '@components/HTMLEngineProvider/HTMLRenderers/VictoryChartRenderer/utils/normalizeVictoryChartPadding';

describe('normalizeVictoryChartPadding', () => {
    const mockFont = {
        getSize: () => 14,
        getMetrics: () => ({
            ascent: -10,
            descent: 3,
            leading: 1,
        }),
    } as any;

    const mockFontWithoutMetrics = {
        getSize: () => 14,
        getMetrics: () => undefined,
    } as any;

    it('expands numeric padding consistently', () => {
        const result = normalizeVictoryChartPadding({
            padding: 20,
            xAxis: undefined,
            yAxis: undefined,
            isHorizontal: false,
        });

        expect(result).toEqual({
            top: 20,
            right: 20,
            bottom: 20,
            left: 20,
        });
    });

    it('uses 50 as default when padding is undefined', () => {
        const result = normalizeVictoryChartPadding({
            padding: undefined,
            xAxis: undefined,
            yAxis: undefined,
            isHorizontal: false,
        });

        expect(result).toEqual({
            top: 50,
            right: 50,
            bottom: 50,
            left: 50,
        });
    });

    it('fills in missing sides with 50 when padding is a partial object', () => {
        const result = normalizeVictoryChartPadding({
            padding: {bottom: 10},
            xAxis: undefined,
            yAxis: undefined,
            isHorizontal: false,
        });

        expect(result).toEqual({
            top: 50,
            right: 50,
            bottom: 10,
            left: 50,
        });
    });

    it('vertical chart with bottom x-axis labels increases bottom padding by the label reserve', () => {
        // labelOffset = 4, tickLabelLineHeight = abs(-10) + 3 + 1 = 14. reserve = 18.
        // bottom padding = 50 + 18 = 68.
        const result = normalizeVictoryChartPadding({
            padding: undefined,
            xAxis: {
                axisSide: 'bottom',
                labelOffset: 4,
                font: mockFont,
            },
            yAxis: undefined,
            isHorizontal: false,
        });

        expect(result).toEqual({
            top: 50,
            right: 50,
            bottom: 68,
            left: 50,
        });
    });

    it('vertical chart without an x-axis font falls back safely to font size', () => {
        // labelOffset = 2 (default), tickLabelLineHeight = 14 (fontSize fallback). reserve = 16.
        // bottom padding = 50 + 16 = 66.
        const result = normalizeVictoryChartPadding({
            padding: undefined,
            xAxis: {
                axisSide: 'bottom',
                font: mockFontWithoutMetrics,
            },
            yAxis: undefined,
            isHorizontal: false,
        });

        expect(result).toEqual({
            top: 50,
            right: 50,
            bottom: 66,
            left: 50,
        });
    });

    it('vertical chart without an x-axis completely falls back safely', () => {
        // xAxis has no font, fontSize falls back to 12. labelOffset falls back to 2. reserve = 14.
        // bottom padding = 50 + 14 = 64.
        const result = normalizeVictoryChartPadding({
            padding: undefined,
            xAxis: {
                axisSide: 'bottom',
            },
            yAxis: undefined,
            isHorizontal: false,
        });

        expect(result).toEqual({
            top: 50,
            right: 50,
            bottom: 64,
            left: 50,
        });
    });

    it('horizontal chart adjusts the independent y-axis side (usually left)', () => {
        // labelOffset = 5, tickLabelLineHeight = abs(-10) + 3 + 1 = 14. reserve = 19.
        // left padding = 50 + 19 = 69.
        const result = normalizeVictoryChartPadding({
            padding: undefined,
            xAxis: undefined,
            yAxis: [
                {
                    axisSide: 'left',
                    labelOffset: 5,
                    font: mockFont,
                },
            ],
            isHorizontal: true,
        });

        expect(result).toEqual({
            top: 50,
            right: 50,
            bottom: 50,
            left: 69,
        });
    });

    it('horizontal chart adjusts y-axis side right if axis is configured on the right side', () => {
        // labelOffset = 2 (default), tickLabelLineHeight = abs(-10) + 3 + 1 = 14. reserve = 16.
        // right padding = 50 + 16 = 66.
        const result = normalizeVictoryChartPadding({
            padding: undefined,
            xAxis: undefined,
            yAxis: [
                {
                    axisSide: 'right',
                    font: mockFont,
                },
            ],
            isHorizontal: true,
        });

        expect(result).toEqual({
            top: 50,
            right: 66,
            bottom: 50,
            left: 50,
        });
    });
});
