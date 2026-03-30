import { useEffect, useState, useRef, useMemo } from 'react';
import { Chart } from './components/Chart';
import { fetchHistoricalCandles, subscribeToKline, fetchMultiTimeframePivots, TimeframePivot, fetchMultiTimeframeCandles } from './lib/binance';
import { Candle, Signal, detectPattern, calculateEMA, calculateTrendlines } from './lib/ta';
import { fetchAndAnalyzeNews, NewsItem } from './lib/news';
import { Activity, ArrowDown, ArrowUp, Clock, ChevronDown, Menu, Bell, Search, Plus, LineChart, TrendingUp, Volume2, Star, Share2, RefreshCw, FileText } from 'lucide-react';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'XAUUSDT', 'BRENTUSDT'];
const INTERVALS = [
  { label: '15M', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '2H', value: '2h' },
  { label: '4H', value: '4h' },
  { label: '6H', value: '6h' },
  { label: '8H', value: '8h' },
  { label: '12H', value: '12h' },
  { label: '1D', value: '1d' },
  { label: '3D', value: '3d' },
  { label: '1W', value: '1w' },
  { label: '1M', value: '1M' }
];

export interface Position {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  size: number;
  leverage: number;
  margin: number;
  time: number;
}

export default function App() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('15m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [multiPivots, setMultiPivots] = useState<Record<string, TimeframePivot>>({});
  const multiPivotsRef = useRef<Record<string, TimeframePivot>>({});
  const [multiTrendlines, setMultiTrendlines] = useState<Record<string, { lines: any[] }>>({});
  
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('positions');
  const [showOrderPanel, setShowOrderPanel] = useState(false);
  const [orderSide, setOrderSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'STOP'>('LIMIT');
  const [entryPrice, setEntryPrice] = useState<string>('');

  // Paper trading state
  const [balance, setBalance] = useState(10000);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orderSize, setOrderSize] = useState('100');
  const [leverage, setLeverage] = useState(10);

  // News state
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [lastNewsSymbol, setLastNewsSymbol] = useState('');

  // We need a ref to access the latest candles in the websocket callback
  const candlesRef = useRef<Candle[]>([]);

  const handleFetchNews = async (force = false) => {
    if (loadingNews) return;
    if (!force && symbol === lastNewsSymbol && news.length > 0) return;
    
    setLoadingNews(true);
    try {
      const fetchedNews = await fetchAndAnalyzeNews(symbol);
      setNews(fetchedNews);
      setLastNewsSymbol(symbol);
    } catch (error) {
      console.error("Failed to fetch news:", error);
    } finally {
      setLoadingNews(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'news') {
      handleFetchNews();
    }
  }, [activeTab, symbol]);

  useEffect(() => {
    let isMounted = true;
    const fetchMT = async () => {
      try {
        const mtc = await fetchMultiTimeframeCandles(symbol, 150);
        if (!isMounted) return;
        const mtl: Record<string, { lines: any[] }> = {};
        for (const [inv, c] of Object.entries(mtc)) {
          mtl[inv] = calculateTrendlines(c);
        }
        setMultiTrendlines(mtl);
      } catch (e) {
        console.error("Failed to fetch multi-timeframe candles", e);
      }
    };
    fetchMT();
    const intervalId = setInterval(fetchMT, 60000); // Refresh every 1 minute
    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [symbol]);

  useEffect(() => {
    let wsUnsubscribe: (() => void) | null = null;
    let isMounted = true;

    const init = async () => {
      setLoading(true);
      try {
        // Fetch multi-timeframe pivots
        const mp = await fetchMultiTimeframePivots(symbol);
        if (!isMounted) return;
        setMultiPivots(mp);
        multiPivotsRef.current = mp;

        // Fetch historical data
        const historical = await fetchHistoricalCandles(symbol, interval, 1000);
        if (!isMounted) return;
        setCandles(historical);
        candlesRef.current = historical;

        // Subscribe to real-time updates
        wsUnsubscribe = subscribeToKline(symbol, interval, (newCandle) => {
          setCandles((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            const last = updated[lastIndex];

            if (last && last.time === newCandle.time) {
              // Update current candle
              updated[lastIndex] = newCandle;
            } else if (last && newCandle.time > last.time) {
              // Add new candle
              updated.push(newCandle);
              // Keep array size manageable
              if (updated.length > 500) updated.shift();
            } else if (!last) {
              updated.push(newCandle);
            } else {
              // Ignore out-of-order old candles
              return prev;
            }

            candlesRef.current = updated;

            // Run TA on closed candles
            if (newCandle.isClosed) {
              const currentPivot = multiPivotsRef.current[interval] || null;
              const signal = detectPattern(updated, symbol, currentPivot);
              if (signal && signal.action !== 'WAIT') {
                setSignals((prevSigs) => {
                  // Avoid duplicates
                  if (prevSigs.find((s) => s.id === signal.id)) return prevSigs;
                  return [signal, ...prevSigs].slice(0, 50); // Keep last 50 signals
                });
              }
            }

            return updated;
          });
        });
      } catch (error) {
        console.error("Failed to initialize:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    init();

    return () => {
      isMounted = false;
      if (wsUnsubscribe) wsUnsubscribe();
    };
  }, [symbol, interval]);

  const emaData = useMemo(() => calculateEMA(candles, 20), [candles.length]);
  
  const trendlines = useMemo(() => calculateTrendlines(candles), [candles.length]);

  const activeTrendlines = useMemo(() => {
    if (!candles.length) return [];
    const currentPrice = candles[candles.length - 1].close;
    const currentTime = candles[candles.length - 1].time as number;
    
    const active: { type: 'upper' | 'lower', expectedValue: number, distance: number, points: {time: number, value: number}[] }[] = [];
    
    for (const line of trendlines.lines) {
      if (line.points.length < 2) continue;
      const p1 = line.points[0];
      const p2 = line.points[1];
      const slopePerSecond = (p2.value - p1.value) / ((p2.time as number) - (p1.time as number));
      const expectedValue = p1.value + slopePerSecond * (currentTime - (p1.time as number));
      const distance = Math.abs(currentPrice - expectedValue) / currentPrice;
      
      // If price is within 0.2% of the trendline
      if (distance < 0.002) {
        active.push({ type: line.type, expectedValue, distance, points: line.points as any });
      }
    }
    return active;
  }, [candles, trendlines]);

  const flashingTimeframes = useMemo(() => {
    if (!candles.length) return {};
    const currentPrice = candles[candles.length - 1].close;
    const currentTime = candles[candles.length - 1].time as number;
    
    const flashing: Record<string, { type: 'upper' | 'lower', expectedValue: number }> = {};
    
    for (const [inv, tl] of Object.entries(multiTrendlines)) {
      for (const line of tl.lines) {
        if (line.points.length < 2) continue;
        const p1 = line.points[0];
        const p2 = line.points[1];
        const slopePerSecond = (p2.value - p1.value) / ((p2.time as number) - (p1.time as number));
        const expectedValue = p1.value + slopePerSecond * (currentTime - (p1.time as number));
        const distance = Math.abs(currentPrice - expectedValue) / currentPrice;
        
        if (distance < 0.002) {
          flashing[inv] = { type: line.type, expectedValue };
          break; // Only need one flashing line per timeframe
        }
      }
    }
    return flashing;
  }, [candles, multiTrendlines]);

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const isUp = candles.length > 0 ? candles[candles.length - 1].close >= candles[candles.length - 1].open : true;
  
  const currentPivot = multiPivots[interval];
  const isAbovePivot = currentPivot ? currentPrice > currentPivot.p : true;

  const handlePlaceOrder = () => {
    if (!candles.length) return;
    const currentPrice = candles[candles.length - 1].close;
    const sizeNum = parseFloat(orderSize);
    if (isNaN(sizeNum) || sizeNum <= 0) return;

    const marginRequired = sizeNum / leverage;
    if (marginRequired > balance) {
      alert('Số dư không đủ');
      return;
    }

    const newPosition: Position = {
      id: Date.now().toString(),
      symbol,
      side: orderSide,
      entryPrice: currentPrice,
      size: sizeNum,
      leverage,
      margin: marginRequired,
      time: Date.now(),
    };

    setPositions([...positions, newPosition]);
    setBalance(balance - marginRequired);
    setShowOrderPanel(false);
  };

  const handleClosePosition = (pos: Position) => {
    if (!candles.length) return;
    const currentPrice = candles[candles.length - 1].close;
    
    // Calculate PnL
    const priceDiff = pos.side === 'LONG' ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
    const pnl = (priceDiff / pos.entryPrice) * pos.size * pos.leverage;
    
    setBalance(balance + pos.margin + pnl);
    setPositions(positions.filter(p => p.id !== pos.id));
  };

  return (
    <div className="min-h-screen bg-black text-slate-50 flex flex-col font-sans pb-20">
      {/* Top Navigation Bar */}
      <header className="bg-black px-3 py-3 flex items-center justify-between sticky top-0 z-50 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="bg-yellow-500 text-black text-xs font-bold px-1.5 py-0.5 rounded">SC</span>
          <span className="text-emerald-500 text-sm font-medium">Crypto and Forex Trading</span>
        </div>
        <div className="flex items-center gap-3">
          <button className="p-1 hover:bg-slate-800 rounded-md">
            <Search className="w-5 h-5 text-slate-300" />
          </button>
          <button className="p-1 hover:bg-slate-800 rounded-md relative">
            <Bell className="w-5 h-5 text-slate-300" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        
        {/* Trading Controls Header */}
        <div className="px-3 py-3 bg-black flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <button className={`flex items-center gap-1 border px-2 py-1 rounded text-xs font-medium ${activeTrendlines.length > 0 ? (activeTrendlines[0].type === 'upper' ? 'border-red-500/50 text-red-500 bg-red-500/5' : 'border-emerald-500/50 text-emerald-500 bg-emerald-500/5') : (isAbovePivot ? 'border-red-500/50 text-red-500 bg-red-500/5' : 'border-emerald-500/50 text-emerald-500 bg-emerald-500/5')}`}>
              Lệnh Chờ {activeTrendlines.length > 0 ? (activeTrendlines[0].type === 'upper' ? 'Short' : 'Long') : (isAbovePivot ? 'Short' : 'Long')} <ChevronDown className="w-3 h-3" />
            </button>
            <div className="relative flex-1">
              <select 
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full border border-slate-700 text-white px-2 py-1 rounded text-xs font-medium bg-[#151924] appearance-none cursor-pointer"
              >
                {SYMBOLS.map(s => (
                  <option key={s} value={s} className="bg-slate-900">{s.replace('USDT', '')}/USDT - {s.replace('USDT', '')}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Long/Short Ratio Bar */}
          <div className="flex flex-col gap-1 mt-1">
            <div className="flex justify-between text-[10px] font-bold px-1">
              <span className="text-emerald-500">Long 69%</span>
              <span className="text-red-500">Short 31%</span>
            </div>
            <div className="h-1.5 w-full rounded-full overflow-hidden flex">
              <div className="bg-emerald-500 h-full" style={{ width: '69%' }}></div>
              <div className="bg-red-500 h-full" style={{ width: '31%' }}></div>
            </div>
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="px-2 pb-2 bg-black">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            {INTERVALS.map(i => {
              const pData = multiPivots[i.value];
              const flashingData = flashingTimeframes[i.value];
              const isFlashing = !!flashingData;
              
              return (
                <div 
                  key={i.value} 
                  className={`flex flex-col items-center justify-center min-w-[60px] py-1 rounded border transition-colors ${interval === i.value ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-[#151924] hover:bg-slate-800'} ${isFlashing ? 'animate-pulse ring-2 ring-yellow-500 bg-yellow-500/20' : ''} cursor-pointer`} 
                  onClick={() => setInterval(i.value)}
                >
                  {isFlashing && flashingData.type === 'upper' ? (
                    <span className="text-[10px] text-yellow-400 font-mono font-bold animate-pulse">{flashingData.expectedValue.toFixed(2)}</span>
                  ) : (
                    <span className="text-[10px] text-red-500 font-mono">{pData ? pData.r1.toFixed(2) : '...'}</span>
                  )}
                  
                  <span className={`text-xs ${interval === i.value ? 'text-emerald-500 font-bold' : 'text-slate-400'} ${isFlashing ? 'text-yellow-400 font-bold' : ''}`}>{i.label}</span>
                  
                  {isFlashing && flashingData.type === 'lower' ? (
                    <span className="text-[10px] text-yellow-400 font-mono font-bold animate-pulse">{flashingData.expectedValue.toFixed(2)}</span>
                  ) : (
                    <span className="text-[10px] text-emerald-500 font-mono">{pData ? pData.s1.toFixed(2) : '...'}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Chart Area */}
        <div className="relative flex flex-col h-[55vh] min-h-[400px] bg-black border-y border-slate-800">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
            </div>
          ) : null}
          
          {/* Chart Overlay Text */}
          <div className="absolute top-2 left-0 right-0 z-10 pointer-events-none overflow-hidden h-6 bg-black/40 flex items-center backdrop-blur-sm">
            <div className="animate-marquee whitespace-nowrap">
              <p className="text-xs text-yellow-500 font-medium inline-block px-4">
                {currentPivot ? (
                  isAbovePivot ? (
                    `Giá đang ở phía trên Pivot (${currentPivot.p.toFixed(2)}), canh long tại ${currentPivot.s1.toFixed(2)}. Nếu giá xuyên thủng ${currentPivot.p.toFixed(2)} sẽ tiến về ${currentPivot.s1.toFixed(2)}`
                  ) : (
                    `Giá đang ở phía dưới Pivot (${currentPivot.p.toFixed(2)}), có xu hướng tiến về Pivot (${currentPivot.p.toFixed(2)}), canh short tại ${currentPivot.r1.toFixed(2)}. Nếu giá vượt qua ${currentPivot.p.toFixed(2)} sẽ tiến về ${currentPivot.r1.toFixed(2)}`
                  )
                ) : 'Đang tải dữ liệu Pivot...'}
              </p>
            </div>
          </div>
          
          {/* Watermark */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-0 opacity-5">
            <h1 className="text-4xl md:text-6xl font-bold text-emerald-500 text-center uppercase tracking-widest">
              SC Crypto<br/>and Forex Trading
            </h1>
          </div>
          
          <div className="flex-1 relative min-h-0">
            <div className="absolute inset-0">
              <Chart data={candles} emaData={emaData} trendlines={trendlines} activeTrendlines={activeTrendlines} />
            </div>
          </div>
        </div>

        {/* Bottom Tabs */}
        <div className="flex bg-black border-b border-slate-800">
          <button 
            onClick={() => setActiveTab('trendlines')}
            className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${activeTab === 'trendlines' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-slate-400'}`}
          >
            <TrendingUp className="w-4 h-4" /> Đường xu hướng
          </button>
          <button 
            onClick={() => setActiveTab('positions')}
            className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${activeTab === 'positions' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-slate-400'}`}
          >
            <Activity className="w-4 h-4" /> Futures
          </button>
          <button 
            onClick={() => setActiveTab('news')}
            className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${activeTab === 'news' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-slate-400'}`}
          >
            <FileText className="w-4 h-4" /> Tin tức
          </button>
          <button 
            onClick={() => setActiveTab('analysis')}
            className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${activeTab === 'analysis' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-slate-400'}`}
          >
            <LineChart className={`w-4 h-4 ${activeTab === 'analysis' ? 'text-emerald-500' : 'text-yellow-500'}`} /> View Biểu Đồ
          </button>
          <button 
            onClick={() => setActiveTab('signals')}
            className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${activeTab === 'signals' ? 'text-emerald-500 border-b-2 border-emerald-500' : 'text-slate-400'}`}
          >
            <Star className={`w-4 h-4 ${activeTab === 'signals' ? 'text-emerald-500' : 'text-yellow-500'}`} /> Tín hiệu
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 bg-black p-3 overflow-y-auto">
          {activeTab === 'signals' && (
            <div className="space-y-4">
              <div className="bg-[#0b0e14] border border-slate-800 rounded-lg p-4">
                <h3 className="text-white font-bold mb-4">Tín hiệu Giao dịch AI</h3>
                
                {signals.length === 0 ? (
                  <div className="text-center text-slate-500 text-sm py-6">
                    Đang chờ tín hiệu mới từ thị trường...
                  </div>
                ) : (
                  <div className="space-y-4">
                    {signals.map((signal) => (
                      <div key={signal.id} className="bg-[#151924] border border-slate-800 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${signal.action === 'LONG' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'}`}>
                              {signal.action} {signal.symbol}
                            </span>
                            <span className="text-slate-400 text-xs">{new Date(signal.time * 1000).toLocaleTimeString()}</span>
                          </div>
                          <span className="text-yellow-500 text-xs font-bold bg-yellow-500/10 px-2 py-1 rounded">
                            Độ tin cậy: {signal.confidence?.toFixed(0)}%
                          </span>
                        </div>

                        <h4 className="text-white font-bold text-sm mb-3">{signal.strategy}</h4>

                        <div className="space-y-2 mb-4">
                          <div className="flex gap-2 items-start">
                            <div className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                              <span className="text-[10px] text-slate-400">1</span>
                            </div>
                            <p className="text-sm text-slate-300">{signal.step1}</p>
                          </div>
                          <div className="flex gap-2 items-start">
                            <div className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                              <span className="text-[10px] text-slate-400">2</span>
                            </div>
                            <p className="text-sm text-slate-300">{signal.step2}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 bg-[#0b0e14] p-3 rounded border border-slate-800/50">
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Entry Price</p>
                            <p className="font-mono text-white">{signal.price.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Stop Loss</p>
                            <p className="font-mono text-red-400">{signal.stopLoss?.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Target (Scalp)</p>
                            <p className="font-mono text-emerald-400">{signal.takeProfitScalp?.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Target (Swing)</p>
                            <p className="font-mono text-emerald-500 font-bold">{signal.takeProfitSwing?.toFixed(2)}</p>
                          </div>
                        </div>
                        
                        <div className="mt-3 flex justify-between items-center text-xs">
                          <span className="text-slate-400">Tỷ lệ R:R</span>
                          <span className="text-white font-bold">1 : {signal.rr?.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'trendlines' && (
            <div className="space-y-4">
              <div className="bg-[#0b0e14] border border-slate-800 rounded-lg p-4">
                <h3 className="text-white font-bold mb-4">Phân tích Đường xu hướng</h3>
                
                {trendlines.lines.length > 0 ? (
                  <div className="space-y-4">
                    {trendlines.lines.filter(l => l.type === 'upper').map((line, idx) => (
                      <div key={`upper-${idx}`} className="bg-[#151924] p-3 rounded border border-slate-800">
                        <p className="text-xs text-slate-400 mb-2">Đường kháng cự (Upper Trendline)</p>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-300">Giá mục tiêu hiện tại:</span>
                          <span className="font-mono font-bold text-red-500">{line.points[1].value.toFixed(2)}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">Được vẽ từ đỉnh {new Date((line.points[0].time as number) * 1000).toLocaleString()}</p>
                      </div>
                    ))}
                    
                    {trendlines.lines.filter(l => l.type === 'lower').map((line, idx) => (
                      <div key={`lower-${idx}`} className="bg-[#151924] p-3 rounded border border-slate-800">
                        <p className="text-xs text-slate-400 mb-2">Đường hỗ trợ (Lower Trendline)</p>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-slate-300">Giá mục tiêu hiện tại:</span>
                          <span className="font-mono font-bold text-emerald-500">{line.points[1].value.toFixed(2)}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">Được vẽ từ đáy {new Date((line.points[0].time as number) * 1000).toLocaleString()}</p>
                      </div>
                    ))}

                    <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded">
                      <p className="text-xs text-blue-400 leading-relaxed">
                        <strong>Lưu ý:</strong> Đường xu hướng được tự động vẽ dựa trên các đỉnh và đáy gần nhất. Giá phá vỡ (breakout) các đường này có thể báo hiệu sự thay đổi xu hướng mạnh.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-slate-500 text-sm py-6">
                    Chưa đủ dữ liệu để vẽ đường xu hướng.
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'positions' && (
            <div className="space-y-3">
              <div className="bg-[#0b0e14] border border-slate-800 rounded-lg p-3 flex justify-between items-center mb-4">
                <span className="text-slate-400 text-sm">Số dư khả dụng:</span>
                <span className="text-white font-bold">${balance.toFixed(2)}</span>
              </div>
              {positions.length === 0 ? (
                <div className="text-center text-slate-500 text-sm mt-10">
                  Chưa có vị thế nào
                </div>
              ) : (
                positions.map((pos) => {
                  const priceDiff = pos.side === 'LONG' ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
                  const pnl = (priceDiff / pos.entryPrice) * pos.size * pos.leverage;
                  const pnlPercent = (pnl / pos.margin) * 100;
                  const isProfit = pnl >= 0;
                  const liqPrice = pos.side === 'LONG' 
                    ? pos.entryPrice * (1 - 1/pos.leverage) 
                    : pos.entryPrice * (1 + 1/pos.leverage);

                  return (
                    <div key={pos.id} className="bg-[#0b0e14] border border-slate-800 rounded-lg p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-1 h-4 rounded-full ${pos.side === 'LONG' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                          <span className="font-bold text-lg text-white">{pos.symbol} Perp</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded border ${pos.side === 'LONG' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                            Cross {pos.leverage}x
                          </span>
                        </div>
                        <Share2 className="w-4 h-4 text-slate-400" />
                      </div>
                      
                      <div className="flex justify-between items-center mb-4">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">Unrealized PNL (USDT)</p>
                          <p className={`text-lg font-bold ${isProfit ? 'text-emerald-500' : 'text-red-500'}`}>
                            {isProfit ? '+' : ''}{pnl.toFixed(2)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-400 mb-1">ROI</p>
                          <p className={`text-lg font-bold ${isProfit ? 'text-emerald-500' : 'text-red-500'}`}>
                            {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-y-3 gap-x-2 text-sm mb-4">
                        <div>
                          <p className="text-xs text-slate-500">Size (USDT)</p>
                          <p className="font-medium text-slate-200">{(pos.size * pos.leverage).toFixed(2)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-slate-500">Margin (USDT)</p>
                          <p className="font-medium text-slate-200">{pos.margin.toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Entry Price (USDT)</p>
                          <p className="font-medium text-slate-200">{pos.entryPrice.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Mark Price (USDT)</p>
                          <p className="font-medium text-slate-200">{currentPrice.toFixed(2)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-slate-500">Liq.Price (USDT)</p>
                          <p className="font-medium text-yellow-500">{liqPrice.toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">TP/SL</p>
                          <p className="font-medium text-slate-200">-- / --</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded text-sm font-medium transition-colors">
                          Đòn bẩy
                        </button>
                        <button className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded text-sm font-medium transition-colors">
                          TP/SL
                        </button>
                        <button 
                          onClick={() => handleClosePosition(pos)}
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded text-sm font-medium transition-colors"
                        >
                          Đóng
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'news' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-[#0b0e14] border border-slate-800 rounded-lg p-3">
                <h3 className="text-white font-bold text-sm">Tin tức & Phân tích AI ({symbol})</h3>
                <button 
                  onClick={() => handleFetchNews(true)}
                  disabled={loadingNews}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingNews ? 'animate-spin' : ''}`} />
                </button>
              </div>
              
              {loadingNews ? (
                <div className="text-center text-slate-500 text-sm py-10">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
                  Đang phân tích tin tức bằng AI...
                </div>
              ) : news.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-10">
                  Không có tin tức nào.
                </div>
              ) : (
                <div className="space-y-3">
                  {news.map((item, index) => (
                    <div key={index} className="bg-[#0b0e14] border border-slate-800 rounded-lg p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-white font-medium text-sm pr-4 leading-snug">{item.headline}</h4>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap ${
                          item.sentiment === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-500' : 
                          item.sentiment === 'BEARISH' ? 'bg-red-500/20 text-red-500' : 
                          'bg-slate-500/20 text-slate-400'
                        }`}>
                          {item.sentiment}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mb-2 leading-relaxed">{item.summary}</p>
                      <div className="bg-[#151924] p-2 rounded border border-slate-800/50">
                        <p className="text-[10px] text-slate-500 font-medium mb-1">Lý do:</p>
                        <p className="text-xs text-slate-300">{item.reasoning}</p>
                      </div>
                      <div className="mt-3 flex justify-between items-center">
                        <span className="text-[10px] text-slate-500">{new Date(item.timestamp).toLocaleString()}</span>
                        <span className="text-[10px] text-slate-500">Nguồn: {item.source}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="space-y-4">
              <div className="bg-[#0b0e14] border border-slate-800 rounded-lg p-4">
                <h3 className="text-white font-bold mb-4">Phân tích kỹ thuật {symbol}</h3>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-[#151924] p-3 rounded border border-slate-800">
                    <p className="text-xs text-slate-400 mb-1">Xu hướng (EMA 20)</p>
                    {emaData.length > 0 && currentPrice > emaData[emaData.length - 1] ? (
                      <p className="text-emerald-500 font-bold text-sm flex items-center gap-1"><ArrowUp className="w-4 h-4" /> TĂNG</p>
                    ) : (
                      <p className="text-red-500 font-bold text-sm flex items-center gap-1"><ArrowDown className="w-4 h-4" /> GIẢM</p>
                    )}
                  </div>
                  <div className="bg-[#151924] p-3 rounded border border-slate-800">
                    <p className="text-xs text-slate-400 mb-1">Trạng thái Pivot</p>
                    {isAbovePivot ? (
                      <p className="text-emerald-500 font-bold text-sm">Trên Pivot</p>
                    ) : (
                      <p className="text-red-500 font-bold text-sm">Dưới Pivot</p>
                    )}
                  </div>
                </div>

                {currentPivot && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-300 mb-2">Các mức hỗ trợ / kháng cự quan trọng:</p>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-red-400">Kháng cự 2 (R2)</span>
                      <span className="font-mono">{currentPivot.r2.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-red-500 font-bold">Kháng cự 1 (R1)</span>
                      <span className="font-mono font-bold">{currentPivot.r1.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm bg-slate-800/50 p-1 rounded">
                      <span className="text-yellow-500 font-bold">Điểm xoay (Pivot)</span>
                      <span className="font-mono font-bold">{currentPivot.p.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-emerald-500 font-bold">Hỗ trợ 1 (S1)</span>
                      <span className="font-mono font-bold">{currentPivot.s1.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-emerald-400">Hỗ trợ 2 (S2)</span>
                      <span className="font-mono">{currentPivot.s2.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}


        </div>
      </main>

      {/* Fixed Bottom Order Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#0b0e14] border-t border-slate-800 p-3 z-50">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <button 
            onClick={() => {
              if (activeTrendlines.length > 0) {
                const active = activeTrendlines[0];
                setOrderSide(active.type === 'upper' ? 'SHORT' : 'LONG');
                setEntryPrice(active.expectedValue.toFixed(2));
              } else {
                setOrderSide(isAbovePivot ? 'SHORT' : 'LONG');
                setEntryPrice(currentPivot ? (isAbovePivot ? currentPivot.r1 : currentPivot.s1).toFixed(2) : '');
              }
              setShowOrderPanel(true);
            }}
            className={`flex-1 text-black font-bold py-2.5 px-4 rounded flex items-center justify-center gap-1 transition-colors ${activeTrendlines.length > 0 ? (activeTrendlines[0].type === 'upper' ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600') : (isAbovePivot ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600')}`}
          >
            <Plus className="w-4 h-4" />
            Tạo lệnh chờ {activeTrendlines.length > 0 ? (activeTrendlines[0].type === 'upper' ? 'Short' : 'Long') : (isAbovePivot ? 'Short' : 'Long')}
          </button>
        </div>
      </div>

      {/* Order Panel Overlay */}
      {showOrderPanel && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#0b0e14] w-full max-w-md rounded-t-xl sm:rounded-xl border border-slate-800 overflow-hidden animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">Tạo lệnh chờ</h3>
              <button onClick={() => setShowOrderPanel(false)} className="text-slate-400 hover:text-white p-1">
                ✕
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex gap-2">
                <button 
                  onClick={() => setOrderSide('LONG')}
                  className={`flex-1 py-1.5 rounded font-bold text-xs border ${orderSide === 'LONG' ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/50' : 'bg-[#151924] text-slate-400 border-slate-800'}`}
                >
                  LONG
                </button>
                <button 
                  onClick={() => setOrderSide('SHORT')}
                  className={`flex-1 py-1.5 rounded font-bold text-xs border ${orderSide === 'SHORT' ? 'bg-red-500/20 text-red-500 border-red-500/50' : 'bg-[#151924] text-slate-400 border-slate-800'}`}
                >
                  SHORT
                </button>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setOrderType('LIMIT')}
                  className={`flex-1 py-1.5 rounded font-bold text-xs border ${orderType === 'LIMIT' ? 'bg-white text-black border-white' : 'bg-[#151924] text-slate-400 border-slate-800'}`}
                >
                  LIMIT
                </button>
                <button 
                  onClick={() => setOrderType('MARKET')}
                  className={`flex-1 py-1.5 rounded font-bold text-xs border ${orderType === 'MARKET' ? 'bg-white text-black border-white' : 'bg-[#151924] text-slate-400 border-slate-800'}`}
                >
                  MARKET
                </button>
                <button 
                  onClick={() => setOrderType('STOP')}
                  className={`flex-1 py-1.5 rounded font-bold text-xs border ${orderType === 'STOP' ? 'bg-white text-black border-white' : 'bg-[#151924] text-slate-400 border-slate-800'}`}
                >
                  STOP
                </button>
              </div>
              
              <div className="space-y-3">
                {orderType !== 'MARKET' && (
                  <div className="flex items-center justify-between bg-[#151924] border border-slate-800 rounded px-3 py-2">
                    <span className="text-xs text-slate-400">Giá Entry</span>
                    <div className="flex items-center gap-2">
                      <input 
                        type="number" 
                        value={entryPrice}
                        onChange={(e) => setEntryPrice(e.target.value)}
                        placeholder="Giá thị trường" 
                        className="bg-transparent text-right text-white text-sm focus:outline-none w-24" 
                      />
                      <span className="text-xs text-slate-400">USDT</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between bg-[#151924] border border-slate-800 rounded px-3 py-2">
                  <span className="text-xs text-slate-400">Đòn bẩy (x)</span>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      value={leverage} 
                      onChange={(e) => setLeverage(Number(e.target.value))}
                      className="bg-transparent text-right text-white text-sm focus:outline-none w-24" 
                    />
                    <span className="text-xs text-slate-400">x</span>
                  </div>
                </div>
                <div className="flex items-center justify-between bg-[#151924] border border-slate-800 rounded px-3 py-2">
                  <span className="text-xs text-slate-400">Khối lượng</span>
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      value={orderSize}
                      onChange={(e) => setOrderSize(e.target.value)}
                      placeholder="0.00" 
                      className="bg-transparent text-right text-white text-sm focus:outline-none w-24" 
                    />
                    <span className="text-xs text-slate-400">USDT</span>
                  </div>
                </div>
                {/* Slider */}
                <div className="pt-3 pb-2 px-2">
                  <div className="h-1 bg-slate-800 rounded-full relative">
                    <div className="absolute top-1/2 -translate-y-1/2 left-[25%] w-2.5 h-2.5 bg-slate-600 rounded-full"></div>
                    <div className="absolute top-1/2 -translate-y-1/2 left-[50%] w-2.5 h-2.5 bg-slate-600 rounded-full"></div>
                    <div className="absolute top-1/2 -translate-y-1/2 left-[75%] w-2.5 h-2.5 bg-slate-600 rounded-full"></div>
                    <div className="absolute top-1/2 -translate-y-1/2 left-[100%] w-2.5 h-2.5 bg-slate-600 rounded-full"></div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between text-xs text-slate-400">
                <span>Ký quỹ yêu cầu</span>
                <span className="text-white">${(parseFloat(orderSize || '0') / leverage).toFixed(2)} USDT</span>
              </div>

              <button 
                onClick={handlePlaceOrder}
                className={`w-full font-bold py-2.5 rounded mt-2 transition-colors text-black ${orderSide === 'LONG' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600'}`}
              >
                {orderSide} {symbol.replace('USDT', '')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
