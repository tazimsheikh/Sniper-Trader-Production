import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { M1TypedArrays } from "../../config/types.js";
import { OPTIMIZER_CONFIG } from "../../config/OptimizerPairConfig.js";

function getDigitsForPair(pair: string): number {
  const optCfg = OPTIMIZER_CONFIG[pair.replace(".Daily", "")];
  const tickSize = optCfg?.tickSize ?? 0.00001;
  const tickStr = tickSize.toString();
  return tickStr.includes('.') ? tickStr.split('.')[1].length : 0;
}

export interface GpuEvalResult {
  totalNetR: number;
  trades: number;
  maxDrawdown: number;
}

export class GpuFitnessBridge {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private tempDir: string;
  private pendingResolve: ((value: any) => void) | null = null;
  private pendingReject: ((reason: any) => void) | null = null;
  private isLoaded = false;
  private currentM1Length = 0;
  private workerId: number;

  constructor() {
    this.workerId = Math.floor(Math.random() * 1000000);
    this.tempDir = path.join(os.tmpdir(), `gpu_fitness_${this.workerId}`);
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  static async start(): Promise<GpuFitnessBridge> {
    const bridge = new GpuFitnessBridge();
    await bridge.initProcess();
    return bridge;
  }

  private initProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(
        process.cwd(),
        "server",
        "trading",
        "optimizer",
        "core",
        "gpu_evaluator.py"
      );

      this.process = spawn("python", [scriptPath]);

      this.process.stderr?.on("data", (data) => {
        console.error(`[GPU EVAL PYTHON ERROR] ${data.toString()}`);
      });

      this.rl = readline.createInterface({
        input: this.process.stdout!,
        terminal: false,
      });

      this.rl.on("line", (line) => {
        try {
          const resp = JSON.parse(line);
          if (resp.status === "ready") {
            console.log(`[GPU] Python Engine Ready (GPU: ${resp.has_gpu})`);
            resolve();
            return;
          }
          if (resp.error) {
            if (this.pendingReject) {
              this.pendingReject(new Error(resp.error));
            }
          } else if (this.pendingResolve) {
            this.pendingResolve(resp);
          }
        } catch (e) {
          if (this.pendingReject) {
            this.pendingReject(e);
          }
        }
        this.pendingResolve = null;
        this.pendingReject = null;
      });

      this.process.on("error", (err) => {
        reject(err);
      });

      this.process.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`[GPU EVAL] Python process exited with code ${code}`);
        }
      });
    });
  }

  private writeArrayBinary(name: string, arr: any, dtype: string): { path: string; dtype: string } {
    const filePath = path.join(this.tempDir, `${name}.bin`);
    
    // Write direct typed array buffer to file
    const buffer = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    fs.writeFileSync(filePath, buffer);
    return { path: filePath, dtype };
  }

  async loadM1Data(m1Typed: M1TypedArrays): Promise<void> {
    if (!this.process) throw new Error("GPU process not initialized");

    const paths = {
      open: this.writeArrayBinary("open", m1Typed.open, "float64"),
      high: this.writeArrayBinary("high", m1Typed.high, "float64"),
      low: this.writeArrayBinary("low", m1Typed.low, "float64"),
      close: this.writeArrayBinary("close", m1Typed.close, "float64"),
      timestamp: this.writeArrayBinary("timestamp", m1Typed.timestamp, "float64"),
      estHour: this.writeArrayBinary("estHour", m1Typed.estHour, "int32"),
      minute: this.writeArrayBinary("minute", m1Typed.minute, "int32"),
      isSessionReset: this.writeArrayBinary("isSessionReset", m1Typed.isSessionReset, "uint8"),
      isMidnightExpiry: this.writeArrayBinary("isMidnightExpiry", m1Typed.isMidnightExpiry, "uint8"),
      isNewsForceClose: this.writeArrayBinary("isNewsForceClose", m1Typed.isNewsForceClose, "uint8"),
    };

    this.currentM1Length = m1Typed.length;

    await new Promise<void>((resolve, reject) => {
      this.pendingResolve = () => {
        this.isLoaded = true;
        resolve();
      };
      this.pendingReject = reject;

      this.process!.stdin!.write(
        JSON.stringify({
          type: "load_m1",
          paths,
        }) + "\n"
      );
    });
  }

  async evaluateBatch(
    symbol: string,
    configTemplate: any,
    triggers: any[],
    chromosomes: any[],
    sessionName: string,
    isForex: boolean,
    botType: "Mage" | "Sage",
    m5Candles?: any[]
  ): Promise<GpuEvalResult[]> {
    if (!this.process) throw new Error("GPU process not initialized");
    if (!this.isLoaded) throw new Error("M1 data not loaded onto GPU");

    const digits = getDigitsForPair(symbol);
    const roundP = (v: number) => parseFloat(v.toFixed(digits));

    const cleanTriggers = triggers.map((t) => {
      const sweepCandle = m5Candles ? m5Candles[t.m5Index - 1] : null;
      const m5Candle    = m5Candles ? m5Candles[t.m5Index]     : null;
      return {
        m1Index: t.m1Index,
        tradingDayId: t.tradingDayId ?? 0,
        m5Timestamp: t.m5Timestamp || (m5Candle ? m5Candle.timestamp : 0),
        orHigh:       t.orHigh != null ? roundP(t.orHigh) : null,
        orLow:        t.orLow  != null ? roundP(t.orLow)  : null,
        direction:    t.direction || "BUY",
        sweepHighVal: sweepCandle ? roundP(sweepCandle.high)  : (t.orHigh != null ? roundP(t.orHigh) : null),
        sweepLowVal:  sweepCandle ? roundP(sweepCandle.low)   : (t.orLow  != null ? roundP(t.orLow)  : null),
        sweepCloseVal:sweepCandle ? roundP(sweepCandle.close) : (t.orLow  != null ? roundP(t.orLow)  : null),
        sweepTimestamp: sweepCandle ? sweepCandle.timestamp : 0,
        m5Close: t.m5Close
          ? roundP(t.m5Close)
          : m5Candle ? roundP(m5Candle.close) : (t.orHigh != null ? roundP(t.orHigh) : null),
        cBodyPips: t.cBodyPips != null ? parseFloat((t.cBodyPips).toFixed(1)) : 0,
        boxSize:   t.boxSize   != null ? roundP(t.boxSize)  : 0,
      };
    });

    const response = await new Promise<any>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      this.process!.stdin!.write(
        JSON.stringify({
          type: "batch",
          symbol,
          config_template: {
            pipSize: configTemplate.pipSize,
            spread: configTemplate.spread,
            digits,
          },
          triggers: cleanTriggers,
          chromosomes,
          session_name: sessionName,
          is_forex: isForex,
          bot_type: botType,
        }) + "\n"
      );
    });

    return response.results;
  }

  async shutdown(): Promise<void> {
    if (this.rl) this.rl.close();
    if (this.process) {
      this.process.kill();
    }
    // Clean up temporary binary files
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup error
    }
  }
}
