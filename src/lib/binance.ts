import { Candle } from './ta';

export interface TimeframePivot {
  interval: string;
  p: number;
  s1: number;
  r1: number;
  s2: number;
  r2: number;
  s3: number;
  r3: number;
}

export async function fetchMultiTimeframePivots(symbol: string): Promise<Record<string, TimeframePivot>> {
  const intervals = ['15m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
  const results: Record<string, TimeframePivot> = {};
  
  if (symbol === 'XAUUSDT' || symbol === 'BRENTUSDT') {
    let basePrice = symbol === 'XAUUSDT' ? 2200 : 85;
    intervals.forEach(inv => {
      const volatility = basePrice * 0.01;
      const h = basePrice + Math.random() * volatility;
      const l = basePrice - Math.random() * volatility;
      const c = l + Math.random() * (h - l);
      const p = (h + l + c) / 3;
      results[inv] = {
        interval: inv,
        p,
        s1: 2 * p - h,
        r1: 2 * p - l,
        s2: p - (h - l),
        r2: p + (h - l),
        s3: l - 2 * (h - p),
        r3: h + 2 * (p - l)
      };
    });
    return results;
  }

  try {
    const promises = intervals.map(async (inv) => {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${inv}&limit=2`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.length > 0) {
        const candle = data[0]; // Previous closed candle
        const h = parseFloat(candle[2]);
        const l = parseFloat(candle[3]);
        const c = parseFloat(candle[4]);
        const p = (h + l + c) / 3;
        results[inv] = {
          interval: inv,
          p,
          s1: 2 * p - h,
          r1: 2 * p - l,
          s2: p - (h - l),
          r2: p + (h - l),
          s3: l - 2 * (h - p),
          r3: h + 2 * (p - l)
        };
      }
    });
    await Promise.all(promises);
  } catch (error) {
    console.error("Failed to fetch multi-timeframe pivots", error);
  }
  return results;
}

function generateMockCandles(symbol: string, interval: string, limit: number): Candle[] {
  const candles: Candle[] = [];
  let basePrice = symbol === 'XAUUSDT' ? 2200 : 85;
  let now = Math.floor(Date.now() / 1000);
  
  let intervalSeconds = 900; // 15m
  if (interval.endsWith('m')) intervalSeconds = parseInt(interval) * 60;
  if (interval.endsWith('h')) intervalSeconds = parseInt(interval) * 3600;
  if (interval.endsWith('d')) intervalSeconds = parseInt(interval) * 86400;
  if (interval.endsWith('w')) intervalSeconds = parseInt(interval) * 86400 * 7;
  
  let startTime = now - (limit * intervalSeconds);
  
  for (let i = 0; i < limit; i++) {
    const open = basePrice;
    const volatility = basePrice * 0.002;
    const high = open + Math.random() * volatility;
    const low = open - Math.random() * volatility;
    const close = low + Math.random() * (high - low);
    basePrice = close;
    
    candles.push({
      time: startTime + (i * intervalSeconds),
      open, high, low, close,
      volume: Math.random() * 1000,
      isClosed: true
    });
  }
  return candles;
}

export async function fetchMultiTimeframeCandles(symbol: string, limit: number = 150): Promise<Record<string, Candle[]>> {
  const intervals = ['15m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
  const results: Record<string, Candle[]> = {};
  
  if (symbol === 'XAUUSDT' || symbol === 'BRENTUSDT') {
    intervals.forEach(inv => {
      results[inv] = generateMockCandles(symbol, inv, limit);
    });
    return results;
  }

  try {
    const promises = intervals.map(async (inv) => {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${inv}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      results[inv] = data.map((d: any) => ({
        time: Math.floor(d[0] / 1000),
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
        isClosed: true,
      }));
    });
    await Promise.all(promises);
  } catch (error) {
    console.error("Failed to fetch multi-timeframe candles", error);
  }
  return results;
}

export async function fetchHistoricalCandles(symbol: string, interval: string, limit: number = 1000): Promise<Candle[]> {
  if (symbol === 'XAUUSDT' || symbol === 'BRENTUSDT') {
    return generateMockCandles(symbol, interval, limit);
  }

  // Use Binance Futures API (fapi)
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    
    return data.map((d: any) => ({
      time: Math.floor(d[0] / 1000),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
      isClosed: true,
    }));
  } catch (error) {
    console.error(`Failed to fetch historical candles for ${symbol}:`, error);
    return [];
  }
}

export function subscribeToKline(symbol: string, interval: string, onMessage: (candle: Candle) => void) {
  if (symbol === 'XAUUSDT' || symbol === 'BRENTUSDT') {
    let basePrice = symbol === 'XAUUSDT' ? 2200 : 85;
    const timer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const volatility = basePrice * 0.0005;
      const change = (Math.random() - 0.5) * volatility;
      basePrice += change;
      onMessage({
        time: now - (now % 60), // align to minute
        open: basePrice - change,
        high: basePrice + Math.abs(change),
        low: basePrice - Math.abs(change),
        close: basePrice,
        volume: Math.random() * 10,
        isClosed: false
      });
    }, 2000);
    return () => clearInterval(timer);
  }

  // Use Futures WebSocket stream
  const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${interval}`);
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.k) return;
    const kline = message.k;
    
    onMessage({
      time: Math.floor(kline.t / 1000),
      open: parseFloat(kline.o),
      high: parseFloat(kline.h),
      low: parseFloat(kline.l),
      close: parseFloat(kline.c),
      volume: parseFloat(kline.v),
      isClosed: kline.x,
    });
  };
  
  ws.onerror = (error) => {
    console.error(`WebSocket error for ${symbol}:`, error);
  };

  return () => ws.close();
}
