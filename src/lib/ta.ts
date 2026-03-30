import { TimeframePivot } from './binance';

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface PivotPoints {
  p: number;
  r1: number;
  s1: number;
  r2: number;
  s2: number;
  r3: number;
  s3: number;
}

export function calculatePivotPoints(high: number, low: number, close: number): PivotPoints {
  const p = (high + low + close) / 3;
  const r1 = (2 * p) - low;
  const s1 = (2 * p) - high;
  const r2 = p + (high - low);
  const s2 = p - (high - low);
  const r3 = high + 2 * (p - low);
  const s3 = low - 2 * (high - p);
  return { p, r1, s1, r2, s2, r3, s3 };
}

export function calculateLocalPivots(candles: Candle[]): PivotPoints | null {
  if (candles.length < 2) return null;
  
  // Use the last 100 closed candles to find High and Low for local pivots
  const lookback = Math.min(100, candles.length - 1);
  const recentCandles = candles.slice(-(lookback + 1), -1); // exclude current open candle
  
  if (recentCandles.length === 0) return null;

  let high = -Infinity;
  let low = Infinity;
  for (const c of recentCandles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  const close = recentCandles[recentCandles.length - 1].close;
  
  return calculatePivotPoints(high, low, close);
}

export interface SRLevel {
  price: number;
  type: 'SUPPORT' | 'RESISTANCE';
  touches: number;
  strength: number; // 0-100
  distancePct: number;
}

export function detectSRLevels(candles: Candle[], currentPrice: number, window: number = 15): SRLevel[] {
  if (candles.length < window * 2) return [];
  
  const highs: number[] = [];
  const lows: number[] = [];
  
  // Find local extrema
  for (let i = window; i < candles.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (i === j) continue;
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  
  // Group close levels
  const groupLevels = (levels: number[], type: 'SUPPORT' | 'RESISTANCE'): SRLevel[] => {
    const grouped: SRLevel[] = [];
    const threshold = currentPrice * 0.003; // 0.3% grouping threshold
    
    for (const level of levels) {
      let found = false;
      for (const g of grouped) {
        if (Math.abs(g.price - level) < threshold) {
          g.price = (g.price * g.touches + level) / (g.touches + 1); // Average price
          g.touches += 1;
          g.strength = Math.min(99, g.touches * 15 + 50); // Simple strength calculation
          found = true;
          break;
        }
      }
      if (!found) {
        grouped.push({ 
          price: level, 
          type, 
          touches: 1, 
          strength: 60,
          distancePct: 0
        });
      }
    }
    
    // Calculate distance and filter
    return grouped.map(g => ({
      ...g,
      distancePct: Math.abs(g.price - currentPrice) / currentPrice * 100
    })).filter(g => g.touches > 1 || g.distancePct < 2); // Keep significant or close levels
  };
  
  const resistance = groupLevels(highs, 'RESISTANCE').filter(r => r.price > currentPrice);
  const support = groupLevels(lows, 'SUPPORT').filter(s => s.price < currentPrice);
  
  return [...resistance, ...support].sort((a, b) => a.distancePct - b.distancePct);
}

export function calculateATR(candles: Candle[], period: number = 14): number[] {
  if (candles.length < period + 1) return [];
  
  const tr: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    
    tr.push(Math.max(tr1, tr2, tr3));
  }
  
  const atr: number[] = [];
  let sumTR = 0;
  for (let i = 1; i <= period; i++) {
    sumTR += tr[i];
  }
  let currentATR = sumTR / period;
  
  for (let i = 0; i < period; i++) {
    atr.push(NaN);
  }
  atr.push(currentATR);
  
  for (let i = period + 1; i < candles.length; i++) {
    currentATR = (currentATR * (period - 1) + tr[i]) / period;
    atr.push(currentATR);
  }
  
  return atr;
}

export type SignalType = 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'HAMMER' | 'SHOOTING_STAR' | 'NONE';

export interface Signal {
  id: string;
  type: SignalType;
  action: 'LONG' | 'SHORT' | 'WAIT';
  price: number;
  time: number;
  description: string;
  symbol: string;
  strategy?: string;
  step1?: string;
  step2?: string;
  stopLoss?: number;
  takeProfitScalp?: number;
  takeProfitSwing?: number;
  rr?: number;
  confidence?: number;
}

export interface Point {
  time: number;
  value: number;
}

export function calculateTrendlines(candles: Candle[]): { lines: { points: Point[], type: 'upper' | 'lower', slope: number, p1Index: number, p1Value: number, p1Time: number }[] } {
  if (candles.length < 20) return { lines: [] };
  
  const lookback = Math.min(150, candles.length);
  const recent = candles.slice(-lookback);
  const startIndex = candles.length - lookback;
  
  const left = 5;
  const right = 5;
  const highs: {time: number, value: number, index: number}[] = [];
  const lows: {time: number, value: number, index: number}[] = [];
  
  for (let i = left; i < recent.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    
    for (let j = i - left; j <= i + right; j++) {
      if (i === j) continue;
      if (recent[j].high >= recent[i].high) isHigh = false;
      if (recent[j].low <= recent[i].low) isLow = false;
    }
    
    if (isHigh) highs.push({time: recent[i].time, value: recent[i].high, index: startIndex + i});
    if (isLow) lows.push({time: recent[i].time, value: recent[i].low, index: startIndex + i});
  }
  
  const lines: { points: Point[], type: 'upper' | 'lower', slope: number, p1Index: number, p1Value: number, p1Time: number }[] = [];
  const lastIndex = candles.length - 1;
  const lastTime = candles[lastIndex].time;

  // Upper trendlines
  if (highs.length >= 2) {
    // Sort highs by value descending
    const sortedHighs = [...highs].sort((a, b) => b.value - a.value);
    
    // Find up to 2 upper trendlines
    for (let k = 0; k < Math.min(2, sortedHighs.length); k++) {
      const p1 = sortedHighs[k];
      let p2 = null;
      let minSlope = Infinity;
      
      for (let i = 0; i < highs.length; i++) {
        if (highs[i].index <= p1.index) continue;
        const candidate = highs[i];
        const slope = (candidate.value - p1.value) / (candidate.index - p1.index);
        
        let isValid = true;
        for (let j = 0; j < highs.length; j++) {
          if (highs[j].index <= p1.index || highs[j].index === candidate.index) continue;
          const expectedValue = p1.value + slope * (highs[j].index - p1.index);
          if (highs[j].value > expectedValue) {
            isValid = false;
            break;
          }
        }
        
        if (isValid && slope < minSlope) {
          minSlope = slope;
          p2 = candidate;
        }
      }
      
      if (p1 && p2) {
        const slope = (p2.value - p1.value) / (p2.index - p1.index);
        const startValue = p1.value + slope * (startIndex - p1.index);
        const projectedValue = p1.value + slope * (lastIndex - p1.index);
        lines.push({
          type: 'upper',
          points: [
            { time: candles[startIndex].time, value: startValue },
            { time: lastTime, value: projectedValue }
          ],
          slope,
          p1Index: p1.index,
          p1Value: p1.value,
          p1Time: p1.time
        });
      }
    }
  }
  
  // Lower trendlines
  if (lows.length >= 2) {
    // Sort lows by value ascending
    const sortedLows = [...lows].sort((a, b) => a.value - b.value);
    
    // Find up to 2 lower trendlines
    for (let k = 0; k < Math.min(2, sortedLows.length); k++) {
      const p1 = sortedLows[k];
      let p2 = null;
      let maxSlope = -Infinity;
      
      for (let i = 0; i < lows.length; i++) {
        if (lows[i].index <= p1.index) continue;
        const candidate = lows[i];
        const slope = (candidate.value - p1.value) / (candidate.index - p1.index);
        
        let isValid = true;
        for (let j = 0; j < lows.length; j++) {
          if (lows[j].index <= p1.index || lows[j].index === candidate.index) continue;
          const expectedValue = p1.value + slope * (lows[j].index - p1.index);
          if (lows[j].value < expectedValue) {
            isValid = false;
            break;
          }
        }
        
        if (isValid && slope > maxSlope) {
          maxSlope = slope;
          p2 = candidate;
        }
      }
      
      if (p1 && p2) {
        const slope = (p2.value - p1.value) / (p2.index - p1.index);
        const startValue = p1.value + slope * (startIndex - p1.index);
        const projectedValue = p1.value + slope * (lastIndex - p1.index);
        lines.push({
          type: 'lower',
          points: [
            { time: candles[startIndex].time, value: startValue },
            { time: lastTime, value: projectedValue }
          ],
          slope,
          p1Index: p1.index,
          p1Value: p1.value,
          p1Time: p1.time
        });
      }
    }
  }

  return { lines };
}

export function detectPatternAtIndex(
  candles: Candle[], 
  index: number, 
  symbol: string, 
  currentPivot: TimeframePivot | null = null
): Signal | null {
  if (index < 2) return null;
  const current = candles[index];
  const prev = candles[index - 1];
  
  const bodySize = Math.abs(current.open - current.close);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const totalSize = current.high - current.low;

  const id = `${symbol}-${current.time}`;
  
  // Advanced logic: Combine with ATR and S/R
  const atrArray = calculateATR(candles.slice(0, index + 1));
  const currentATR = atrArray[atrArray.length - 1] || (current.high - current.low);
  
  let type: SignalType = 'NONE';
  let action: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
  let description = '';
  let strategy = '';
  let step1 = '';
  let step2 = '';
  let confidence = 0;
  let entryPrice = current.close;

  const srLevels = detectSRLevels(candles.slice(0, index + 1), current.close);
  const nearestResistance = srLevels.find(l => l.type === 'RESISTANCE');
  const nearestSupport = srLevels.find(l => l.type === 'SUPPORT');

  // Check for candlestick patterns
  const isBullishEngulfing = prev.close < prev.open && current.close > current.open && current.open <= prev.close && current.close >= prev.open;
  const isBearishEngulfing = prev.close > prev.open && current.close < current.open && current.open >= prev.close && current.close <= prev.open;
  const isHammer = current.close > current.open && lowerWick > bodySize * 2 && upperWick < bodySize * 0.2;
  const isShootingStar = current.close < current.open && upperWick > bodySize * 2 && lowerWick < bodySize * 0.2;

  // Check for support/resistance touches (Pivot or SR)
  const touchS1 = currentPivot ? current.low <= currentPivot.s1 : false;
  const touchR1 = currentPivot ? current.high >= currentPivot.r1 : false;
  const nearSupport = nearestSupport ? nearestSupport.distancePct < 0.5 : false;
  const nearResistance = nearestResistance ? nearestResistance.distancePct < 0.5 : false;

  // Combine patterns with support/resistance
  if (isBullishEngulfing && (touchS1 || nearSupport)) {
    type = 'BULLISH_ENGULFING';
    action = 'LONG';
    strategy = touchS1 ? 'Chiến thuật LONG tại S1' : 'Chiến thuật LONG tại Support';
    step1 = touchS1 ? `Giá chạm hỗ trợ S1 tại ${currentPivot!.s1.toFixed(2)}` : `Giá đã test đường hỗ trợ tại ${nearestSupport!.price.toFixed(2)}`;
    step2 = 'Xác nhận mô hình nến Bullish Engulfing';
    confidence = touchS1 ? 90 : nearestSupport!.strength;
    entryPrice = touchS1 ? currentPivot!.s1 : nearestSupport!.price;
  } else if (isBearishEngulfing && (touchR1 || nearResistance)) {
    type = 'BEARISH_ENGULFING';
    action = 'SHORT';
    strategy = touchR1 ? 'Chiến thuật SHORT tại R1' : 'Chiến thuật SHORT tại Resistance';
    step1 = touchR1 ? `Giá chạm kháng cự R1 tại ${currentPivot!.r1.toFixed(2)}` : `Giá đã test đường kháng cự tại ${nearestResistance!.price.toFixed(2)}`;
    step2 = 'Xác nhận mô hình nến Bearish Engulfing';
    confidence = touchR1 ? 90 : nearestResistance!.strength;
    entryPrice = touchR1 ? currentPivot!.r1 : nearestResistance!.price;
  } else if (isHammer && (touchS1 || nearSupport)) {
    type = 'HAMMER';
    action = 'LONG';
    strategy = touchS1 ? 'Chiến thuật LONG tại S1' : 'Chiến thuật LONG tại Support';
    step1 = touchS1 ? `Giá chạm hỗ trợ S1 tại ${currentPivot!.s1.toFixed(2)}` : `Giá đã test đường hỗ trợ tại ${nearestSupport!.price.toFixed(2)}`;
    step2 = 'Xác nhận nến Hammer rút râu';
    confidence = touchS1 ? 85 : nearestSupport!.strength - 5;
    entryPrice = touchS1 ? currentPivot!.s1 : nearestSupport!.price;
  } else if (isShootingStar && (touchR1 || nearResistance)) {
    type = 'SHOOTING_STAR';
    action = 'SHORT';
    strategy = touchR1 ? 'Chiến thuật SHORT tại R1' : 'Chiến thuật SHORT tại Resistance';
    step1 = touchR1 ? `Giá chạm kháng cự R1 tại ${currentPivot!.r1.toFixed(2)}` : `Giá đã test đường kháng cự tại ${nearestResistance!.price.toFixed(2)}`;
    step2 = 'Xác nhận nến Shooting Star rút râu';
    confidence = touchR1 ? 85 : nearestResistance!.strength - 5;
    entryPrice = touchR1 ? currentPivot!.r1 : nearestResistance!.price;
  }

  if (action !== 'WAIT') {
    const stopLoss = action === 'LONG' ? entryPrice - currentATR * 1.5 : entryPrice + currentATR * 1.5;
    const takeProfitScalp = action === 'LONG' ? entryPrice + currentATR * 1.5 : entryPrice - currentATR * 1.5;
    const takeProfitSwing = action === 'LONG' ? entryPrice + currentATR * 3 : entryPrice - currentATR * 3;
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfitScalp - entryPrice);
    const rr = reward / risk;

    return {
      id, symbol, type, action, price: entryPrice, time: current.time,
      description: type.replace('_', ' '),
      strategy, step1, step2,
      stopLoss, takeProfitScalp, takeProfitSwing, rr, confidence
    };
  }

  return null;
}

export function getIntervalSeconds(interval: string): number {
  const unit = interval.slice(-1);
  const value = parseInt(interval.slice(0, -1));
  switch (unit) {
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    case 'w': return value * 604800;
    case 'M': return value * 2592000; // Approx 30 days
    default: return 3600;
  }
}

export function detectPattern(
  candles: Candle[], 
  symbol: string, 
  currentPivot: TimeframePivot | null = null
): Signal | null {
  if (candles.length < 3) return null;
  const current = candles[candles.length - 1];
  if (!current.isClosed) return null;
  return detectPatternAtIndex(candles, candles.length - 1, symbol, currentPivot);
}

export function calculateEMA(candles: Candle[], period: number): number[] {
  const k = 2 / (period + 1);
  let emaArray: number[] = [];
  
  if (candles.length < period) return emaArray;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let prevEma = sum / period;
  
  for (let i = 0; i < period - 1; i++) {
    emaArray.push(NaN);
  }
  emaArray.push(prevEma);

  for (let i = period; i < candles.length; i++) {
    const ema = (candles[i].close - prevEma) * k + prevEma;
    emaArray.push(ema);
    prevEma = ema;
  }

  return emaArray;
}

