import { useState, useEffect } from 'react';

export interface NewsEvent {
  id: string;
  date: string; // YYYY-MM-DD
  timeUTC: string; 
  currency: string;
  event: string;
  impact: 'HIGH' | 'MID' | 'LOW';
  forecast: string;
  previous: string;
  actual: string | null;
  deviation: 'positive' | 'negative' | 'neutral' | null;
}

export function useEconomicNews() {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  
  const [activeWarning, setActiveWarning] = useState<{
    event: NewsEvent;
    minutesLeft: number;
    minutesPassed: number;
    status: 'UPCOMING' | 'RECENT';
  } | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchRealCalendar() {
      try {
        const response = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        
        const parsedEvents: NewsEvent[] = data.map((item: any, index: number) => {
          // Date comes as "2026-05-25T01:00:00-04:00"
          const dateObj = new Date(item.date);
          const dateStr = dateObj.toISOString().split('T')[0];
          const timeStr = `${dateObj.getUTCHours().toString().padStart(2, '0')}:${dateObj.getUTCMinutes().toString().padStart(2, '0')}`;
          
          let impactLevel: 'HIGH' | 'MID' | 'LOW' = 'LOW';
          if (item.impact === 'High') impactLevel = 'HIGH';
          if (item.impact === 'Medium') impactLevel = 'MID';

          return {
            id: `real-news-${index}`,
            date: dateStr,
            timeUTC: timeStr,
            currency: item.country,
            event: item.title,
            impact: impactLevel,
            forecast: item.forecast || '--',
            previous: item.previous || '--',
            actual: null, // We won't have actuals immediately unless we parse them differently, but for now we set it to null and let the timer reveal 'Released'
            deviation: 'neutral' as const
          };
        });

        if (isMounted) {
          setEvents(parsedEvents);
        }
      } catch (error) {
        console.error("Failed to fetch real economic calendar data:", error);
      }
    }

    fetchRealCalendar();

    const timer = setInterval(() => {
      const currentNow = new Date();
      setCurrentTime(currentNow);

      const totalUTCMinutes = currentNow.getUTCHours() * 60 + currentNow.getUTCMinutes();
      const currentTodayStr = currentNow.toISOString().split('T')[0];
      let currentWarning = null;

      setEvents(prev => {
        let changed = false;
        const updated = prev.map(evt => {
          let finalEvt = { ...evt };

          if (evt.date === currentTodayStr) {
            const [evtHour, evtMin] = evt.timeUTC.split(':').map(Number);
            const evtTotalMinutes = evtHour * 60 + evtMin;
            const diffMinutes = evtTotalMinutes - totalUTCMinutes;

            if (diffMinutes <= 0 && !evt.actual) {
              finalEvt.actual = evt.forecast !== '--' ? evt.forecast : 'Released';
              finalEvt.deviation = 'neutral';
              changed = true;
            }

            if (evt.impact === 'HIGH') {
              if (diffMinutes > 0 && diffMinutes <= 15) {
                currentWarning = {
                  event: finalEvt,
                  minutesLeft: diffMinutes,
                  minutesPassed: 0,
                  status: 'UPCOMING' as const
                };
              }
              else if (diffMinutes <= 0 && diffMinutes >= -15) {
                currentWarning = {
                  event: finalEvt,
                  minutesLeft: 0,
                  minutesPassed: Math.abs(diffMinutes),
                  status: 'RECENT' as const
                };
              }
            }
          }
          return finalEvt;
        });
        
        setActiveWarning(currentWarning);
        return changed ? updated : (currentWarning !== activeWarning ? updated : prev);
      });

    }, 30000); // Check every 30 seconds instead of rapid re-renders

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  return { events, currentTime, activeWarning };
}
