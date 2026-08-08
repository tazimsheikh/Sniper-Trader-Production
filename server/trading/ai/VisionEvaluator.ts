// ============================================================
// VISION AI EVALUATOR
// Sends chart images to Gemini Vision and gets structured
// trade decisions back — mimicking a human trader's eyes.
// ============================================================
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import {
  STACY_BURKE_SYSTEM_PROMPT,
  buildChartAnalysisPrompt,
  buildSystemPrompt,
} from "./StacyBurkePrompt.js";
import { PromptVault } from "./PromptVault.js";
import { enqueueVisionRequest } from "../../utils/VisionApiQueue.js";
export type { VisionDecision } from "../config/types.js";
import {
  VisionDecision,
  VisionEvalContext,
  MageEvalContext,
} from "../config/types.js";

const NO_TRADE_DECISION: VisionDecision = {
  decision: "NO_TRADE",
  confidence: 0,
  setupQuality: "POOR",
  patternVisible: false,
  reasoning: "Failed to get AI evaluation",
  entry: null,
  stopLoss: null,
  takeProfit: null,
  riskPips: null,
};

export class VisionEvaluator {
  private genai: GoogleGenAI;
  private callCount = 0;
  private totalCostUSD = 0;
  private model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string = "gemini-2.5-flash") {
    this.apiKey = apiKey;
    this.model = model;
    this.genai = new GoogleGenAI({ apiKey });
  }

  async evaluate(
    chartImageBuffers: Buffer | Buffer[],
    context: VisionEvalContext,
    overrideSystemPrompt?: string,
    overrideUserPrompt?: string,
  ): Promise<VisionDecision> {
    this.callCount++;
    const startTime = Date.now();

    const prompt = overrideUserPrompt || buildChartAnalysisPrompt(context);
    const sysPrompt =
      overrideSystemPrompt ||
      buildSystemPrompt(context.setupType, context.direction);

    if (process.env.SIMULATION_MODE === "true") {
      return {
        decision: (context.direction || (context as any).expectedDirection) as "BUY" | "SELL" | "NO_TRADE",
        confidence: 99,
        setupQuality: 100,
        patternVisible: true,
        reasoning: "Simulation mode mock decision",
        entry: null,
        stopLoss: null,
        takeProfit: null,
        riskPips: null,
      };
    }

    try {
      // Convert PNG buffer(s) to base64 parts
      const buffers = Array.isArray(chartImageBuffers)
        ? chartImageBuffers
        : [chartImageBuffers];
      const imageParts = buffers.map((buf) => ({
        inlineData: {
          mimeType: "image/png",
          data: buf.toString("base64"),
        },
      }));

      let rawText = "";
      let promptTokens = 2300;
      let responseTokens = 200;

      // All Gemini calls go through the global queue: concurrency-limited,
      // timeout-guarded, and auto-retried with exponential backoff.
      const tag = `DiscVision:${context.pair}:${context.setupType}`;
      ({ rawText, promptTokens, responseTokens } = await enqueueVisionRequest(
        async (signal) => {
          const response = await this.genai!.models.generateContent({
            model: this.model,
            config: {
              systemInstruction: sysPrompt,
              temperature: 0.1,
              maxOutputTokens: 8192,
              // 🛡️ BUG FIX: AbortSignal must be inside config, not as a 2nd argument.
              // When the 15s queue timeout fires, this cancels the underlying HTTP
              // request so we don't burn API quota on a dead request.
              abortSignal: signal,
              safetySettings: [
                {
                  category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                  category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                  category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
                {
                  category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                  threshold: HarmBlockThreshold.BLOCK_NONE,
                },
              ],
            },
            contents: [
              {
                role: "user",
                parts: [...imageParts, { text: prompt }],
              },
            ],
          });

          const text =
            response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (
            !text.includes("}") ||
            (!text.includes("```json") && !text.includes("{"))
          ) {
            throw new Error("Truncated or missing JSON response from Gemini");
          }

          return {
            rawText: text,
            promptTokens: response.usageMetadata?.promptTokenCount || 2300,
            responseTokens: response.usageMetadata?.candidatesTokenCount || 200,
          };
        },
        tag,
      ));

      const elapsed = Date.now() - startTime;

      console.log(
        `[VisionAI] #${this.callCount} | ${context.pair} ${context.setupType} | ${elapsed}ms`,
      );

      return this.parseResponse(rawText, context);
    } catch (err: any) {
      console.error(`[VisionAI] Error evaluating chart:`, err.message);
      return { ...NO_TRADE_DECISION, reasoning: `API Error: ${err.message}` };
    }
  }

  async evaluateMageBreakout(
    chartImageBuffers: Buffer | Buffer[],
    context: MageEvalContext,
  ): Promise<VisionDecision> {
    this.callCount++;
    const startTime = Date.now();

    const sysPrompt = PromptVault.getMagePrompt(context);
    const prompt = `Please evaluate the Opening Range Breakout shown in this chart.`;

    try {
      const buffers = Array.isArray(chartImageBuffers)
        ? chartImageBuffers
        : [chartImageBuffers];
      const imageParts = buffers.map((buf) => ({
        inlineData: { mimeType: "image/png", data: buf.toString("base64") },
      }));

      const tag = `MageVision:${context.pair}:ORB`;
      const { rawText } = await enqueueVisionRequest(async (signal) => {
        const response = await this.genai!.models.generateContent({
          model: this.model,
          config: {
            systemInstruction: sysPrompt,
            temperature: 0.1,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
            abortSignal: signal,
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
              {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
            ],
          },
          contents: [
            { role: "user", parts: [...imageParts, { text: prompt }] },
          ],
        });

        const candidate = response.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text ?? "";
        const finishReason = candidate?.finishReason;

        if (finishReason && finishReason !== "STOP") {
          console.warn(`[VisionAI] Abnormal finish reason: ${finishReason}`);
        }

        if (!text.includes("{")) {
          console.error(`[VisionAI] WEIRD TEXT:`, text);
        }

        return { rawText: text, promptTokens: 0, responseTokens: 0 };
      }, tag);

      const elapsed = Date.now() - startTime;
      console.log(
        `[VisionAI] #${this.callCount} | ${context.pair} MAGE ORB | ${elapsed}ms`,
      );

      return this.parseResponse(rawText, {} as any);
    } catch (err: any) {
      console.error(`[VisionAI] Error evaluating Mage chart:`, err.message);
      return { ...NO_TRADE_DECISION, reasoning: `API Error: ${err.message}` };
    }
  }

  private parseResponse(raw: string, ctx: VisionEvalContext): VisionDecision {
    try {
      // Extract JSON from the response (may be wrapped in markdown code blocks)
      const jsonMatch =
        raw.match(/```json\s*([\s\S]*?)\s*```/) ||
        raw.match(/```\s*([\s\S]*?)\s*```/) ||
        raw.match(/(\{[\s\S]*?\})/);

      if (!jsonMatch) {
        console.warn(
          `[VisionAI] No JSON found in response: ${raw.substring(0, 200)}`,
        );
        return { ...NO_TRADE_DECISION, rawResponse: raw };
      }

      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

      // Validate decision
      if (!["BUY", "SELL", "NO_TRADE"].includes(parsed.decision)) {
        return { ...NO_TRADE_DECISION, rawResponse: raw };
      }

      // Directional filtering is delegated ENTIRELY to the AI prompt.
      // We no longer hard-reject counter-trend trades here, as Stacy Burke allows counter-trend reversals at extreme lows on First Red Days.

      return {
        decision: parsed.decision,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        setupQuality: parsed.macroQuality || parsed.setupQuality || "POOR",
        patternVisible: Boolean(parsed.patternVisible),
        reasoning: String(parsed.reasoning || ""),
        entry: parsed.entry ? Number(parsed.entry) : null,
        stopLoss: parsed.stopLoss ? Number(parsed.stopLoss) : null,
        takeProfit: parsed.takeProfit ? Number(parsed.takeProfit) : null,
        riskPips: parsed.riskPips ? Number(parsed.riskPips) : null,
        rawResponse: raw,
      };
    } catch (err: any) {
      console.error(
        `[VisionAI] JSON parse error: ${err.message}`,
        raw.substring(0, 500),
      );
      return { ...NO_TRADE_DECISION, rawResponse: raw };
    }
  }

  getStats() {
    return {
      calls: this.callCount,
      totalCostUSD: this.totalCostUSD,
    };
  }
}
