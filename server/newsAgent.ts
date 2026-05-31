function getApiKey() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn('[NewsAgent] OPENROUTER_API_KEY is missing. Calendar will not update.');
    return null;
  }
  return apiKey;
}

export async function fetchLiveEconomicCalendar(): Promise<any[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

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
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "perplexity/llama-3.1-sonar-large-128k-online",
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!res.ok) {
      throw new Error(`OpenRouter API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    let text = data.choices[0].message.content || "";
    
    // Clean up potential markdown formatting from Perplexity
    if (text.includes('\`\`\`json')) {
      text = text.split('\`\`\`json')[1].split('\`\`\`')[0];
    } else if (text.includes('\`\`\`')) {
      text = text.split('\`\`\`')[1].split('\`\`\`')[0];
    }

    const parsedData = JSON.parse(text.trim());
    if (Array.isArray(parsedData)) {
      return parsedData;
    }
  } catch (err: any) {
    console.error('[NewsAgent] Failed to fetch economic calendar from OpenRouter:', err.message);
  }
  
  return [];
}
