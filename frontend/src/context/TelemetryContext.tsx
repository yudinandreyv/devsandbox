import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { TelemetryData, ExperimentRun } from '../types/telemetry';

interface TelemetryContextType {
  telemetry: TelemetryData;
  elapsedSeconds: number;
  recordExperiment: (run: Omit<ExperimentRun, 'id' | 'timestamp' | 'deltaPercentVsPrevious'>) => ExperimentRun;
  measurePing: () => Promise<number | null>;
  resetTelemetry: () => void;
  resetSessionTimer: () => void;
  clearHistory: () => void;
}

const STORAGE_KEY = 'dev_sandbox_telemetry';

const generateUuid = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const TelemetryContext = createContext<TelemetryContextType | undefined>(undefined);

export const TelemetryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [telemetry, setTelemetry] = useState<TelemetryData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!parsed.runsHistory) parsed.runsHistory = [];
        if (parsed.successfulRuns === undefined) parsed.successfulRuns = parsed.probesExecuted || 0;
        if (parsed.failedRuns === undefined) parsed.failedRuns = 0;
        return parsed;
      }
    } catch {
      // fallback
    }
    return {
      guestSessionId: generateUuid(),
      guestToken: '',
      sessionStartTime: Date.now(),
      sessionDurationSeconds: 0,
      probesExecuted: 0,
      successfulRuns: 0,
      failedRuns: 0,
      bytesScannedKb: 0,
      lastPingLatencyMs: 42,
      currentTheme: 'dark',
      currentLocale: 'en',
      runsHistory: [],
    };
  });

  const timerRef = useRef<number | null>(null);

  // Live stopwatch counter
  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
      setTelemetry((prev) => {
        const updated = {
          ...prev,
          sessionDurationSeconds: prev.sessionDurationSeconds + 1,
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // Ignore
        }
        return updated;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Measure initial ping
  useEffect(() => {
    measurePing();
  }, []);

  const measurePing = async (): Promise<number | null> => {
    const start = performance.now();
    try {
      const res = await fetch('/api/v1/health');
      if (res.ok) {
        const latency = Math.round(performance.now() - start);
        setTelemetry((prev) => {
          const updated = { ...prev, lastPingLatencyMs: latency };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });
        return latency;
      }
    } catch {
      // Offline / dev fallback
    }
    return null;
  };

  const recordExperiment = (runData: Omit<ExperimentRun, 'id' | 'timestamp' | 'deltaPercentVsPrevious'>): ExperimentRun => {
    const prevRun = telemetry.runsHistory[0];
    let deltaPercent: number | undefined = undefined;

    if (prevRun && prevRun.elapsedMs > 0) {
      // Delta in execution time: negative means faster!
      deltaPercent = Math.round(((runData.elapsedMs - prevRun.elapsedMs) / prevRun.elapsedMs) * 100);
    }

    const fullRun: ExperimentRun = {
      ...runData,
      id: generateUuid(),
      timestamp: Date.now(),
      deltaPercentVsPrevious: deltaPercent,
    };

    setTelemetry((prev) => {
      const isSuccess = runData.status === 'success';
      const updated: TelemetryData = {
        ...prev,
        probesExecuted: prev.probesExecuted + 1,
        successfulRuns: prev.successfulRuns + (isSuccess ? 1 : 0),
        failedRuns: prev.failedRuns + (isSuccess ? 0 : 1),
        bytesScannedKb: prev.bytesScannedKb + Math.round(runData.dataScannedBytes / 1024),
        runsHistory: [fullRun, ...prev.runsHistory.slice(0, 19)], // Keep last 20 runs
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });

    return fullRun;
  };

  const resetSessionTimer = () => {
    const resetAt = Date.now();
    setElapsedSeconds(0);
    setTelemetry((prev) => {
      const updated = {
        ...prev,
        sessionStartTime: resetAt,
        sessionDurationSeconds: 0,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const clearHistory = () => {
    setTelemetry((prev) => {
      const updated = { ...prev, runsHistory: [] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const resetTelemetry = () => {
    const fresh: TelemetryData = {
      guestSessionId: generateUuid(),
      guestToken: '',
      sessionStartTime: Date.now(),
      sessionDurationSeconds: 0,
      probesExecuted: 0,
      successfulRuns: 0,
      failedRuns: 0,
      bytesScannedKb: 0,
      lastPingLatencyMs: 42,
      currentTheme: 'dark',
      currentLocale: 'en',
      runsHistory: [],
    };
    setTelemetry(fresh);
    setElapsedSeconds(0);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  };

  return (
    <TelemetryContext.Provider
      value={{
        telemetry,
        elapsedSeconds,
        recordExperiment,
        measurePing,
        resetTelemetry,
        resetSessionTimer,
        clearHistory,
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
};

export const useTelemetry = () => {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return context;
};
