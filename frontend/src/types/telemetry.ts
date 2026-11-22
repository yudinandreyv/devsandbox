export interface ExperimentRun {
  id: string;
  timestamp: number;
  scenario: string;
  scenarioLabel: string;
  concurrency: number;
  delayMs: number;
  elapsedMs: number;
  eventLoopLagMs: number;
  effectiveRps: number;
  queriesExecuted: number;
  dataScannedBytes: number;
  eventLoopBlocked: boolean;
  deltaPercentVsPrevious?: number; // e.g. -85% or +400%
  insight: string;
  status: 'success' | 'error';
}

export interface TelemetryData {
  guestSessionId: string;
  guestToken: string;
  probesExecuted: number;
  successfulRuns: number;
  failedRuns: number;
  bytesScannedKb: number;
  lastPingLatencyMs: number | null;
  currentTheme: 'light' | 'dark';
  currentLocale: 'en' | 'ru';
  runsHistory: ExperimentRun[];
}

export type SupportedLocale = 'en' | 'ru';
