import { ChatMessage, TrapSignal } from '../src/types';

const AI_PERSONA = `
You are the Sniper Trading Analyst — an AI assistant connected to the live trading engine. 
Talk to the user naturally like an AI. Answer their questions directly in their language.
You are provided with live context of what the bots are currently doing. Only use this information when discussing the bots' activities. Do not behave like a pre-programmed bot; be conversational and helpful.
`;

function getApiKey() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set.');
  }
  return process.env.OPENROUTER_API_KEY;
}

// ── Signal verification ────────────────────────────────────────────────────────
export async function verifySignalWithAI(
  symbol: string,
  pattern: string
): Promise<{ approved: boolean; reasoning: string }> {
  try {
    const apiKey = getApiKey();
    
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: AI_PERSONA },
          { role: "user", content: `A signal was generated for ${symbol} with pattern "${pattern}". Reply in JSON format: { "approved": boolean, "reasoning": "string" }.` }
        ]
      })
    });

    if (!res.ok) {
      throw new Error(`OpenRouter API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  } catch (err: any) {
    console.error('[TutorAgent] AI verification failed:', err.message);
    return {
      approved: false,
      reasoning: `AI verification unavailable (${err.message}). Signal rejected as a safety precaution.`
    };
  }
}

// ── Tutor chat ─────────────────────────────────────────────────────────────────
export async function askTutorAgent(
  userPrompt: string,
  history: ChatMessage[],
  liveContext?: any
): Promise<string> {
  let contextString = '';
  if (liveContext) {
    contextString = `\n\n[LIVE ENGINE CONTEXT]\nYou are currently connected to the live trading engine. Here is what the bots are doing right now:\n`;
    const bots = liveContext.bots || [];
    if (bots.length === 0) {
      contextString += `- The engine is currently idle or scanning without active bots.\n`;
    } else {
      bots.forEach((b: any) => {
        contextString += `- Bot [${b.id}] on ${b.symbol} is currently: ${b.status}. Details: ${b.details}\n`;
      });
    }
    contextString += `\nUse this live context to inform your answers.`;
  }

  const systemMessageContent = AI_PERSONA + contextString;

  const MAX_HISTORY = 20;
  const truncatedHistory = history.slice(-MAX_HISTORY);

  const messages = [
    { role: "system", content: systemMessageContent },
    ...truncatedHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    })),
    { role: "user", content: userPrompt }
  ];

  try {
    const apiKey = getApiKey();
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: messages
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenRouter API error: ${res.status} ${res.statusText} - ${errText}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  } catch (err: any) {
    console.error('[TutorAgent] Chat API error:', err.message);
    return "I'm sorry, I'm having trouble connecting to my systems right now. Please try again later.";
  }
}
