import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

export default function TopNavWidgets() {
  const [timeState, setTimeState] = useState({
    utcClock: '',
  });
  const [metaApiStatus, setMetaApiStatus] = useState<'offline' | 'syncing' | 'connected'>('offline');

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    const pollStatus = async () => {
      try {
        const sRes = await fetch('/api/auth/metaapi/status', { signal: controller.signal, credentials: 'same-origin' });
        if (mounted && sRes.ok) {
          const sData = await sRes.json();
          if (sData?.success) {
            setMetaApiStatus(prev => prev !== sData.status ? sData.status : prev);
          }
        }
      } catch (e: any) {
        // silent
      }
    };

    pollStatus();
    const intervalStatus = setInterval(pollStatus, 5000); // 5s is fine for API status

    const updateClock = () => {
      const now = new Date();
      const utcHours = now.getUTCHours();
      const utcMinutes = now.getUTCMinutes();
      const totalMin = utcHours * 60 + utcMinutes;

      let tzString = 'UTC';
      const selectedTimezone = localStorage.getItem('sniper_tz') || 'IST';
      
      if (selectedTimezone === 'IST')  tzString = 'Asia/Kolkata';
      else if (selectedTimezone === 'EST') tzString = 'America/New_York';
      else if (selectedTimezone === 'GMT') tzString = 'Europe/London';
      else if (selectedTimezone === 'JST') tzString = 'Asia/Tokyo';
      else if (selectedTimezone === 'AEDT') tzString = 'Australia/Sydney';

      const timeStr = now.toLocaleTimeString('en-US', { hour12: false, timeZone: tzString }) + ' ' + selectedTimezone;
      
      setTimeState(prev => {
        if (prev.utcClock === timeStr) {
            return prev;
        }
        return { utcClock: timeStr };
      });
    };

    updateClock();
    const intervalClock = setInterval(updateClock, 1000);

    return () => { 
        mounted = false; 
        controller.abort(); 
        clearInterval(intervalStatus); 
        clearInterval(intervalClock);
    };
  }, []);

  return (
    <>
      <button className={`text-[9px] cursor-default uppercase tracking-widest font-black px-2 py-0.5 border rounded shadow-[0_0_10px_rgba(99,102,241,0.2)] transition-colors ${
        metaApiStatus === 'connected' ? 'text-emerald-300 border-emerald-400/30 bg-emerald-950/50' : 
        metaApiStatus === 'syncing' ? 'text-amber-300 border-amber-400/30 bg-amber-950/50' :
        'text-rose-300 border-rose-400/30 bg-rose-950/50'
      }`}>
        {metaApiStatus === 'connected' ? '🟢 API Connected' : metaApiStatus === 'syncing' ? '🟡 API Syncing' : '🔴 API Offline'}
      </button>

      <div className="flex-1" />

      <div className="bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2 font-mono text-[11px] text-indigo-300 shadow-inner">
        <Clock size={13} className="text-indigo-400" />
        <span>{timeState.utcClock || 'Synching GMT...'}</span>
      </div>

    </>
  );
}
