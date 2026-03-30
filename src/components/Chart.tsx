import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, LineData, CandlestickSeries, LineSeries, IPriceLine, Time } from 'lightweight-charts';
import { Candle, Point } from '../lib/ta';

interface ChartProps {
  data: Candle[];
  emaData: number[];
  trendlines?: { lines: { points: Point[], type: 'upper' | 'lower' }[] };
  activeTrendlines?: { type: 'upper' | 'lower', expectedValue: number, distance: number, points: {time: number, value: number}[] }[];
}

export function Chart({ data, emaData, trendlines = { lines: [] }, activeTrendlines = [] }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  
  // Custom price lines refs
  const targetLineRef = useRef<IPriceLine | null>(null);
  
  const trendlineSeriesRefs = useRef<{series: ISeriesApi<"Line">, line: any, baseColor: string}[]>([]);
  const latestCandleRef = useRef<{price: number, time: number} | null>(null);

  useEffect(() => {
    if (data.length > 0) {
      const last = data[data.length - 1];
      latestCandleRef.current = { price: last.close, time: last.time as number };
    }
  }, [data]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!latestCandleRef.current) return;
      const { price, time } = latestCandleRef.current;

      trendlineSeriesRefs.current.forEach(({ series, line, baseColor }) => {
        if (line.points.length < 2) return;
        const p1 = line.points[0];
        const p2 = line.points[1];
        const slopePerSecond = (p2.value - p1.value) / ((p2.time as number) - (p1.time as number));
        const expectedValue = p1.value + slopePerSecond * (time - (p1.time as number));
        const distance = Math.abs(price - expectedValue) / price;

        if (distance < 0.002) {
          const currentColor = series.options().color;
          series.applyOptions({
            color: currentColor === '#eab308' ? baseColor : '#eab308',
            lineWidth: 3,
          });
        } else {
          const currentColor = series.options().color;
          if (currentColor !== baseColor) {
            series.applyOptions({
              color: baseColor,
              lineWidth: 2,
            });
          }
        }
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#000000' }, // Pure black background
        textColor: '#94a3b8', // Tailwind slate-400
      },
      grid: {
        vertLines: { color: '#1e293b', style: 4 }, // Dotted lines
        horzLines: { color: '#1e293b', style: 4 },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#1e293b',
      },
      rightPriceScale: {
        borderColor: '#1e293b',
      }
    });
    
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) { return; }
      const newRect = entries[0].contentRect;
      chart.applyOptions({ height: newRect.height, width: newRect.width });
    });
    resizeObserver.observe(chartContainerRef.current);

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', // emerald-500
      downColor: '#ef4444', // red-500
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    seriesRef.current = candlestickSeries as unknown as ISeriesApi<"Candlestick">;

    const emaSeries = chart.addSeries(LineSeries, {
      color: '#f59e0b', // amber-500
      lineWidth: 1,
      crosshairMarkerVisible: false,
      title: 'EMA 20',
    });
    emaSeriesRef.current = emaSeries as unknown as ISeriesApi<"Line">;

    // Trendlines will be added dynamically in the other useEffect

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      const formattedData: CandlestickData[] = data.map(d => ({
        time: d.time as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));
      
      // Ensure data is strictly ascending and unique by time
      const uniqueData = Array.from(new Map(formattedData.map(item => [item.time, item])).values())
        .sort((a, b) => (a.time as number) - (b.time as number));

      try {
        const currentData = seriesRef.current.data();
        const isSameDataset = currentData.length > 0 && uniqueData.length > 0 && currentData[0].time === uniqueData[0].time;
        
        if (isSameDataset && (uniqueData.length === currentData.length || uniqueData.length === currentData.length + 1)) {
          // Update the last candle (appends if new time, updates if same time)
          seriesRef.current.update(uniqueData[uniqueData.length - 1]);
        } else {
          seriesRef.current.setData(uniqueData);
        }
      } catch (e) {
        console.error("Error setting chart data", e);
      }
    }
  }, [data]);

  useEffect(() => {
    if (chartRef.current) {
      try {
        // Remove old trendlines
        trendlineSeriesRefs.current.forEach(({ series }) => {
          chartRef.current?.removeSeries(series as any);
        });
        trendlineSeriesRefs.current = [];

        // Add new trendlines
        trendlines.lines.forEach(line => {
          const isUpper = line.type === 'upper';
          const baseColor = isUpper ? '#ef4444' : '#10b981'; // Red for upper, Green for lower
          
          const series = chartRef.current!.addSeries(LineSeries, { 
            color: baseColor,
            lineWidth: 2, 
            lineStyle: 0, 
            crosshairMarkerVisible: false,
          }) as unknown as ISeriesApi<"Line">;
          
          if (line.points.length > 0) {
            series.setData(line.points.map(p => ({ time: p.time as any, value: p.value })));
          }
          trendlineSeriesRefs.current.push({ series, line, baseColor });
        });
      } catch (e) {
        console.error("Error setting trendlines", e);
      }
    }
  }, [trendlines]);

  useEffect(() => {
    if (emaSeriesRef.current && emaData.length > 0 && data.length > 0) {
      const formattedEma: LineData[] = [];
      for(let i=0; i<data.length; i++) {
        if(!isNaN(emaData[i])) {
          formattedEma.push({ time: data[i].time as any, value: emaData[i] });
        }
      }
      
      const uniqueEma = Array.from(new Map(formattedEma.map(item => [item.time, item])).values())
        .sort((a, b) => (a.time as number) - (b.time as number));

      try {
        const currentEma = emaSeriesRef.current.data();
        const isSameDataset = currentEma.length > 0 && uniqueEma.length > 0 && currentEma[0].time === uniqueEma[0].time;
        
        if (isSameDataset && (uniqueEma.length === currentEma.length || uniqueEma.length === currentEma.length + 1)) {
          emaSeriesRef.current.update(uniqueEma[uniqueEma.length - 1]);
        } else {
          emaSeriesRef.current.setData(uniqueEma);
        }
      } catch (e) {}
    }
  }, [emaData, data]);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      if (activeTrendlines.length > 0) {
        const active = activeTrendlines[0];
        const isUpper = active.type === 'upper';
        const title = isUpper ? 'Điểm Đặt Lệnh Short' : 'Điểm Đặt Lệnh Long';
        const color = isUpper ? '#ef4444' : '#10b981';
        
        if (!targetLineRef.current) {
          targetLineRef.current = seriesRef.current.createPriceLine({
            price: active.expectedValue,
            color: color,
            lineWidth: 2,
            lineStyle: 2, // dashed
            axisLabelVisible: true,
            title: title,
          });
        } else {
          targetLineRef.current.applyOptions({ 
            price: active.expectedValue,
            color: color,
            title: title
          });
        }
      } else {
        if (targetLineRef.current) {
          seriesRef.current.removePriceLine(targetLineRef.current);
          targetLineRef.current = null;
        }
      }
    }
  }, [activeTrendlines, data]);

  return <div ref={chartContainerRef} className="w-full h-full" />;
}
