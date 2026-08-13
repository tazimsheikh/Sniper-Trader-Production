import winston from 'winston';
import 'winston-daily-rotate-file';
import { AsyncLocalStorage } from 'async_hooks';

// ── Global Context ───────────────────────────────────────────────────────────
// This carries the current Profile Name transparently through async callbacks
export const profileContext = new AsyncLocalStorage<number>();

// ── chalk (ESM-only) via dynamic import cache ─────────────────────────────────
let _chalk: any = null;
async function getChalk() {
  if (!_chalk) {
    const m = await import('chalk');
    _chalk = m.default ?? m;
  }
  return _chalk;
}

// ── Profile name registry (profileId → human label) ──────────────────────────
const profileNames = new Map<number, string>();

export function registerProfileName(profileId: number, name: string) {
  profileNames.set(profileId, name);
}

export function getProfileLabel(profileId: number | null | undefined): string {
  if (profileId == null) return '';
  return profileNames.get(profileId) ?? `Profile #${profileId}`;
}

// ── Level config ──────────────────────────────────────────────────────────────
type Level = 'info' | 'warn' | 'error' | 'verbose' | 'debug';

const LEVEL_CONFIG: Record<Level, { badge: string; color: string }> = {
  info:    { badge: '•', color: 'cyan'    },
  warn:    { badge: '⚠', color: 'yellow'  },
  error:   { badge: '✖', color: 'red'     },
  verbose: { badge: '›', color: 'gray'    },
  debug:   { badge: '⟐', color: 'magenta' },
};

// ── Global Console Hijack Setup ────────────────────────────────────────────────
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

// ── Timestamp formatter ───────────────────────────────────────────────────────
const _istFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

function fmtTime(): string {
  const now = new Date();
  const parts = _istFormatter.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${get('hour')}:${get('minute')}:${get('second')}.${ms} IST`;
}

// ── Sanitise a raw message ────────────────────────────────────────────────────
function sanitise(raw: string): string {
  return raw.replace(/`/g, "'").replace(/\s{3,}/g, '  ').trim();
}

// ── Core print (sync — uses pre-loaded chalk or plain fallback) ───────────────
function printLine(level: Level, profileId: number | null, msg: string) {
  const cfg = LEVEL_CONFIG[level] ?? LEVEL_CONFIG.info;
  const time = fmtTime();
  const profileTag = profileId != null ? `[${getProfileLabel(profileId)}] ` : '';
  const clean = sanitise(msg);

  if (_chalk) {
    const c = _chalk;
    const colorFn = (c as any)[cfg.color] ?? c.white;
    const text = level === 'error' ? c.red(clean) : level === 'warn' ? c.yellow(clean) : clean;
    const tag  = profileTag ? c.bold(c.magenta(profileTag)) : '';
    const line = `${c.dim(time)}  ${colorFn(cfg.badge)}  ${tag}${text}`;
    if (level === 'error') origError(line);
    else if (level === 'warn') origWarn(line);
    else origLog(line);
  } else {
    const line = `${time}  [${level.toUpperCase()}]  ${profileTag}${clean}`;
    if (level === 'error') origError(line);
    else if (level === 'warn') origWarn(line);
    else origLog(line);
  }
}

// Eagerly warm up chalk so the first real log is coloured
getChalk().catch(() => {});

// ── File transport (plain text, no colour codes) ──────────────────────────────
const isVerbose = String(process.env.VERBOSE_LOGGING).trim().toLowerCase() === 'true';

const winstonFile = winston.createLogger({
  level: isVerbose ? 'verbose' : 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: () => fmtTime(), // IST, consistent with console output
    }),
    winston.format.printf(({ level, message, timestamp }) =>
      `${timestamp} [${level.toUpperCase()}] ${message}`
    )
  ),
  transports: [
    new (winston.transports as any).DailyRotateFile({
      filename: 'logs/app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
    })
  ],
});

// ── Util: stringify an array of args into one clean line ─────────────────────
function joinArgs(args: any[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack ?? a.message;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

// ── ProfileLogger — bound to a specific profile ───────────────────────────────
export class ProfileLogger {
  constructor(private readonly profileId: number) {}

  private _log(level: Level, args: any[]) {
    const msg = joinArgs(args);
    printLine(level, this.profileId, msg);
    (winstonFile as any)[level]?.(`[${getProfileLabel(this.profileId)}] ${msg}`);
  }

  info    = (...args: any[]) => this._log('info',    args);
  warn    = (...args: any[]) => this._log('warn',    args);
  error   = (...args: any[]) => this._log('error',   args);
  verbose = (...args: any[]) => { if (isVerbose) this._log('verbose', args); };
  log     = (...args: any[]) => this._log('info',    args);
}

// ── Global logger (fallback / no explicit profile tag) ─────────────────────
export const logger = {
  info:    (...args: any[]) => { const p = profileContext.getStore() ?? null; printLine('info',    p, joinArgs(args)); winstonFile.info(joinArgs(args));    },
  warn:    (...args: any[]) => { const p = profileContext.getStore() ?? null; printLine('warn',    p, joinArgs(args)); winstonFile.warn(joinArgs(args));    },
  error:   (...args: any[]) => { const p = profileContext.getStore() ?? null; printLine('error',   p, joinArgs(args)); winstonFile.error(joinArgs(args));   },
  verbose: (...args: any[]) => { if (isVerbose) { const p = profileContext.getStore() ?? null; printLine('verbose', p, joinArgs(args)); winstonFile.verbose(joinArgs(args)); } },
  log:     (...args: any[]) => { const p = profileContext.getStore() ?? null; printLine('info',    p, joinArgs(args)); winstonFile.info(joinArgs(args));    },
};

// ── Global Console Hijack ─────────────────────────────────────────────────────
let isHijacked = false;
export function hijackConsole() {
  if (isHijacked) return;
  isHijacked = true;
  
  // Replace the default console methods so any raw console.log anywhere in the codebase uses the clean format
  console.log = (...args: any[]) => logger.info(...args);
  console.warn = (...args: any[]) => logger.warn(...args);
  console.error = (...args: any[]) => logger.error(...args);
  console.info = (...args: any[]) => logger.info(...args);
  console.debug = (...args: any[]) => logger.verbose(...args);
}

// Automatically hijack on load
hijackConsole();
