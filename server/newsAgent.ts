import { GoogleGenAI } from '@google/genai';

let _ai: any = null;
function getAI() {
  if (!_ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[NewsAgent] GEMINI_API_KEY is missing. Calendar will not update.');
      return null;
    }
    _ai = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  }
  return _ai;
}

export async function fetchLiveEconomicCalendar(): Promise<any[]> {
  const ai = getAI();
  if (!ai) return [];

  const today = new Date().toISOString().split('T')[0];
  const prompt = `Search the web for this week's high-impact and medium-impact macroeconomic events (starting from ${today}) from major economic calendars (like Forex Factory or Investing.com) for USD, EUR, GBP, JPY, AUD, CAD, CHF, NZD.

Return a JSON array of events matching this exact schema:
[{
  "title": "Core CPI m/m",
  "country": "USD",
  "date": "2026-05-25T12:30:00Z",
  "impact": "High",
  "forecast": "0.3%",
  "previous": "0.4%",
  "actual": ""
}]

Rules:
1. "date" MUST be a valid ISO-8601 string in UTC (ending in 'Z' or with a timezone offset) representing the exact date and time of the event.
2. "impact" MUST be exactly one of: "High", "Medium", "Low".
3. "country" is the 3-letter currency code (e.g. USD, EUR, GBP).
4. Do not include extra text, return ONLY the JSON array.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      config: { responseMimeType: 'application/json' }
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      if (Array.isArray(data)) {
        return data;
      }
    }
  } catch (err: any) {
    console.error('[NewsAgent] Failed to fetch economic calendar from Gemini:', err.message);
  }
  
  return [];
}

export async function fetchEventResult(title: string, country: string, dateIso: string): Promise<{ actual: string; deviation: string } | null> {
  const ai = getAI();
  if (!ai) return null;

  const prompt = `Search the web for the ACTUAL released result of the macroeconomic event "${title}" for ${country} that occurred on ${dateIso}.
Look for financial news sites (e.g., Forex Factory, Investing.com) for the release.
Return a JSON object with this exact schema:
{
  "actual": "string with the actual number, or empty string if not found yet",
  "deviation": "positive, negative, or neutral based on how it compares to the forecast. Use null if not found."
}
Return ONLY the JSON object. Do not explain.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      config: { responseMimeType: 'application/json' }
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      if (data && typeof data.actual !== 'undefined') {
        return {
          actual: data.actual,
          deviation: data.deviation || null
        };
      }
    }
  } catch (err: any) {
    console.error(`[NewsAgent] Failed to fetch actuals for ${title}:`, err.message);
  }
  return null;
}
