import React, { useState } from 'react';
import { Play, Volume2, VolumeX, Sparkles, ExternalLink, ShieldCheck } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

export const VideoAdSlot: React.FC = () => {
  const { locale } = useI18n();
  const isRu = locale === 'ru';
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  return (
    <aside
      className="w-full min-h-[260px] rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-slate-900 text-white p-5 flex flex-col justify-between overflow-hidden shadow-sm relative group"
      aria-label="Sponsored Outstream Video Slot"
    >
      {/* Top Header Badge */}
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            {isRu ? 'РЕКЛАМНОЕ ВИДЕО / SPONSORED' : 'REWARDED VIDEO AD'}
          </span>
          <span className="text-[10px] font-mono text-slate-400">
            CLS: 0.000 (Reserved Slot)
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5" />
          <span>Bot Safe Mode</span>
        </div>
      </div>

      {/* Main Interactive Screen */}
      <div className="my-4 py-8 flex flex-col items-center justify-center text-center relative z-10">
        {!isPlaying ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setIsPlaying(true)}
              className="w-14 h-14 rounded-full bg-brand-500 hover:bg-brand-400 text-white flex items-center justify-center mx-auto shadow-lg shadow-brand-500/30 transition-transform hover:scale-105 cursor-pointer"
              title={isRu ? 'Воспроизвести видео' : 'Play video'}
              aria-label={isRu ? 'Воспроизвести видео' : 'Play video'}
            >
              <Play aria-hidden="true" className="w-6 h-6 ml-1 fill-white" />
            </button>
            <div>
              <h3 className="text-sm font-bold text-white">
                {isRu
                  ? 'Пока страницы индексируются: видео-разбор Event Loop в Python'
                  : 'While indexing in Google: Python Event Loop Architecture Breakdown'}
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                {isRu
                  ? '3-минутный интерактивный разбор: почему `async def` с `time.sleep` роняет сервер и как работает AnyIO тредпул.'
                  : '3-minute technical deep dive: why `time.sleep` in `async def` starves worker thread pools.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-lg aspect-video rounded-xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center p-6 space-y-3 animate-fade-in">
            <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
            <p className="text-xs font-mono text-brand-400">
              {isRu ? 'Загрузка рекламного видеопотока...' : 'Connecting to Outstream Ad Stream...'}
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsMuted(!isMuted)}
                aria-pressed={isMuted}
                aria-label={isMuted ? (isRu ? 'Включить звук' : 'Unmute') : (isRu ? 'Выключить звук' : 'Mute')}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
              >
                {isMuted ? <VolumeX aria-hidden="true" className="w-4 h-4" /> : <Volume2 aria-hidden="true" className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => setIsPlaying(false)}
                className="px-3 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
              >
                {isRu ? 'Закрыть видео' : 'Close Video'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800 pt-3 z-10">
        <span className="flex items-center gap-1">
          <Sparkles aria-hidden="true" className="w-3.5 h-3.5 text-brand-400" />
          {isRu ? 'Партнёрский блок: Hetzner / Google Cloud / Cloudflare' : 'Partner: Cloudflare / Hetzner Cloud'}
        </span>
        <a
          href="https://github.com/yudinandreyv/devsandbox"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white flex items-center gap-1 font-mono transition-colors"
        >
          <span>GitHub</span>
          <ExternalLink aria-hidden="true" className="w-3 h-3" />
        </a>
      </div>
    </aside>
  );
};
