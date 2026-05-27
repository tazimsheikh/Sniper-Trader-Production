import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

async function fetchAprilNews() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing.');
    return;
  }
  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });

  const prompt = `Search the web for the high-impact macroeconomic events that occurred in April 2026 for USD, EUR, GBP, JPY, AUD, CAD, CHF, NZD. Look at Forex Factory or Investing.com historical calendars for April 1, 2026 to April 30, 2026.

Return a JSON array of events matching this schema:
[{
  "title": "NFP",
  "country": "USD",
  "date": "2026-04-03T12:30:00Z",
  "impact": "High"
}]

Rules:
1. "date" MUST be a valid ISO-8601 string in UTC representing the exact date and time of the event.
2. Only include High impact events.
3. Return ONLY the JSON array. Ensure all major USD events like NFP, CPI, PPI, FOMC, GDP are included.`;

  console.log('Fetching April 2026 news using Gemini...');
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      config: { responseMimeType: 'application/json' }
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      fs.writeFileSync('april_news.json', JSON.stringify(data, null, 2));
      console.log(`Saved ${data.length} events to april_news.json`);
    } else {
      console.log('No text returned.');
    }
  } catch (err: any) {
    console.error('Failed:', err.message);
  }
}

fetchAprilNews();
