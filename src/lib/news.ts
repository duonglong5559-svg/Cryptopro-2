import { GoogleGenAI, Type } from "@google/genai";

export interface NewsItem {
  headline: string;
  summary: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasoning: string;
  source: string;
  timestamp: string;
}

export async function fetchAndAnalyzeNews(symbol: string): Promise<NewsItem[]> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not set. Returning mock news.");
      return getMockNews(symbol);
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `You are an expert cryptocurrency and financial analyst. 
    Find the absolute latest real news from the last 24 hours for the trading pair or asset ${symbol}. 
    Use Google Search to find the most recent and relevant news articles.
    Analyze the sentiment of each news item and provide a brief reasoning.
    Return exactly 3 news items.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING, description: "The news headline" },
              summary: { type: Type.STRING, description: "A short summary of the news" },
              sentiment: { type: Type.STRING, description: "BULLISH, BEARISH, or NEUTRAL" },
              reasoning: { type: Type.STRING, description: "Why this news has this sentiment" },
              source: { type: Type.STRING, description: "A plausible source like CoinDesk, Bloomberg, etc." },
              timestamp: { type: Type.STRING, description: "ISO 8601 timestamp of the news" }
            },
            required: ["headline", "summary", "sentiment", "reasoning", "source", "timestamp"]
          }
        }
      }
    });

    if (response.text) {
      const parsed = JSON.parse(response.text);
      return parsed as NewsItem[];
    }
    
    return getMockNews(symbol);
  } catch (error) {
    console.error("Error analyzing news with Gemini:", error);
    return getMockNews(symbol);
  }
}

function getMockNews(symbol: string): NewsItem[] {
  const now = new Date();
  return [
    {
      headline: `${symbol} Sees Increased Institutional Interest`,
      summary: `Major financial institutions are reportedly increasing their exposure to ${symbol}, citing long-term growth potential.`,
      sentiment: 'BULLISH',
      reasoning: 'Institutional adoption typically brings more liquidity and validates the asset.',
      source: 'CryptoNews',
      timestamp: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
    },
    {
      headline: `Regulatory Uncertainty Weighs on ${symbol}`,
      summary: `New comments from regulators have sparked concerns about potential stricter rules for ${symbol} trading.`,
      sentiment: 'BEARISH',
      reasoning: 'Regulatory crackdowns can lead to decreased trading volume and investor panic.',
      source: 'Financial Times',
      timestamp: new Date(now.getTime() - 1000 * 60 * 120).toISOString(),
    },
    {
      headline: `${symbol} Network Upgrade Scheduled for Next Month`,
      summary: `Developers have confirmed the date for the highly anticipated network upgrade, promising lower fees and faster transactions.`,
      sentiment: 'BULLISH',
      reasoning: 'Technical improvements enhance the utility and attractiveness of the network.',
      source: 'CoinDesk',
      timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 5).toISOString(),
    }
  ];
}
