export interface MarketData {
  symbol: string;
  displayName: string;
  currentPrice: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  hod: number;
  lod: number;
  hos: number;
  los: number;
  how: number;
  low_week: number;
  pipSize: number;
  change: number;
  changePercent: number;
  signalDay: 'FRD' | 'FGD' | 'Inside Day' | 'Normal';
  dayOfWeek: number;
  dayOfWeekCycle: 1 | 2 | 3;
  mondayHigh: number;
  mondayLow: number;
  asianHigh: number;
  asianLow: number;
  londonHigh: number;
  londonLow: number;
  londonOpen: number;
  londonClose: number;
  londonNarrative: 'PUMP' | 'DUMP' | 'NONE';
  last15MSwingHigh?: number;
  last15MSwingLow?: number;
  adr14?: number;
  recentDailyCandles: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
  lastUpdated: string;
}

export interface TrapSignal {
  id: string;
  symbol: string;
  displayName: string;
  pattern: string;
  direction: 'BUY' | 'SELL';
  triggerPrice: number;
  levelType: 'HOD' | 'LOD' | 'HOW' | 'LOW' | 'HOS' | 'LOS' | 'Round Number' | 'Breakout Trap';
  keyLevel: number;
  grade: 1 | 2 | 3 | 4 | 5; // Star rating based on Confluence Points
  timingGate: 'Asian Session' | 'London Session' | 'New York Session' | 'COMEX Open' | 'Major News Spike' | 'Equity Open Box' | '10:00 AM Club' | 'Gap Time';
  timestamp: string;
  details: string;
  confluenceMatrix?: any; // The raw data matrix and grading packet
  suggestedStopLoss: number; // in pips/points (e.g. 25 pips)
  suggestedTakeProfit: number; // measured move target
  isThreeDaySetup?: boolean;
  isThreeSessionSetup?: boolean;
  isHolyGrailConfluence?: boolean;
  status?: 'Wait' | 'Get Ready' | 'Trade Now' | 'Trade Expired';
  tutorAnalysis?: {
    setupType: string;
    gradeJustification: string;
    trappedAudience: string;
    executionSteps: string[];
    riskManagementRules: string;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  relatedSignalId?: string;
}
