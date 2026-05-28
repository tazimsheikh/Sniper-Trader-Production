import React, { useState, useEffect, useRef } from 'react';
import { TrapSignal, MarketData } from '../types';
import { Phone, PhoneOff, Mic, Headphones } from 'lucide-react';

interface VoiceTutorCallProps {
  market: MarketData;
  activeSignal: TrapSignal | null;
  onTutorAnswerSpoken?: (text: string) => void;
}

export default function VoiceTutorCall({ market, activeSignal, onTutorAnswerSpoken }: VoiceTutorCallProps) {
  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState<'IDLE' | 'DIALING' | 'CONNECTED' | 'LISTENING' | 'THINKING' | 'SPEAKING'>('IDLE');
  const [transcript, setTranscript] = useState<{ role: 'student' | 'coach'; message: string; timestamp: Date }[]>([
    {
      role: 'coach',
      message: "Ready to interact.",
      timestamp: new Date()
    }
  ]);
  const [waveHeight, setWaveHeight] = useState<number[]>(Array(18).fill(10));
  
  const recognitionRef = useRef<any>(null);
  const waveAnimRef = useRef<number | null>(null);
  const isCallingRef = useRef<boolean>(false);

  useEffect(() => {
    isCallingRef.current = isCalling;
  }, [isCalling]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition && !recognitionRef.current) {
      try {
        const rec = new SpeechRecognition();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        let finalTranscriptStr = "";

        rec.onresult = async (event: any) => {
           let interimTranscript = '';
           for (let i = event.resultIndex; i < event.results.length; ++i) {
               const chunk = event.results[i][0].transcript;
               if (event.results[i].isFinal) {
                   finalTranscriptStr += chunk;
                   const cleanTxt = finalTranscriptStr.trim();
                   // Only respond to human voice if the length is substantial (not a random noise)
                   if (cleanTxt.length > 2) {
                       if (window.speechSynthesis) window.speechSynthesis.cancel();
                       handleStudentQuestion(cleanTxt);
                       finalTranscriptStr = ""; 
                   }
               } else {
                   interimTranscript += chunk;
                   const cleanInterim = chunk.trim();
                   // If user genuinely says something over 4 characters long, cancel AI speaking
                   if (cleanInterim.length > 4 && isCallingRef.current && window.speechSynthesis && window.speechSynthesis.speaking) {
                       window.speechSynthesis.cancel();
                   }
               }
           }
        };

        rec.onerror = (err: any) => {
          if (isCallingRef.current) setCallStatus('CONNECTED');
        };

        rec.onend = () => {
            // Keep listening if call is active
            if (isCallingRef.current && recognitionRef.current) {
                try {
                    recognitionRef.current.start();
                } catch (e) {}
            }
        };

        recognitionRef.current = rec;
      } catch (e) {
      }
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.abort();
        } catch(e) {}
      }
    };
  }, []);

  useEffect(() => {
    if (callStatus === 'SPEAKING' || callStatus === 'LISTENING') {
      const animateWave = () => {
        setWaveHeight(prev => prev.map(() => {
          const magnitude = callStatus === 'SPEAKING' ? 45 : 18;
          return Math.floor(Math.random() * magnitude) + 12;
        }));
        waveAnimRef.current = requestAnimationFrame(animateWave);
      };
      animateWave();
    } else {
      if (waveAnimRef.current) {
        cancelAnimationFrame(waveAnimRef.current);
        waveAnimRef.current = null;
      }
      setWaveHeight(Array(18).fill(8));
    }

    return () => {
      if (waveAnimRef.current) cancelAnimationFrame(waveAnimRef.current);
    };
  }, [callStatus]);

  const speakOutLoud = (txt: string) => {
    if (!window.speechSynthesis || !isCallingRef.current) return;
    window.speechSynthesis.cancel();

    const cleanText = txt.replace(/[\*#_`]/g, '').replace(/-\s+/g, ' ').slice(0, 300); 

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 0.95; 

    utterance.onstart = () => {
      setCallStatus('SPEAKING');
    };

    utterance.onend = () => {
      if (isCallingRef.current) setCallStatus('LISTENING');
    };

    utterance.onerror = () => {
      if (isCallingRef.current) setCallStatus('LISTENING');
    };

    if (isCallingRef.current) {
       window.speechSynthesis.speak(utterance);
    }
  };

  const startVoiceCall = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setCallStatus('DIALING');
    setIsCalling(true);
    
    setTimeout(() => {
      if (!isCallingRef.current) return;
      setCallStatus('LISTENING');
      if (recognitionRef.current) {
          try { recognitionRef.current.start(); } catch(e) {}
      }
      const greeting = `Hello. What setup are we analyzing today?`;
      speakOutLoud(greeting);
    }, 1500);
  };

  const stopVoiceCall = () => {
    isCallingRef.current = false;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsCalling(false);
    setCallStatus('IDLE');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
    }
  };

  const handleStudentQuestion = async (question: string) => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setCallStatus('THINKING');
    setTranscript(prev => [...prev, { role: 'student', message: question, timestamp: new Date() }]);

    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${question} (Please give a concise explanation ideal for a live spoken call. Keep it within 3-4 sentences maximum in a direct sniper-style coach tone.)`,
          relatedSignalId: activeSignal?.id
        })
      });

      const data = await res.json();
      if (data && data.success && data.response) {
        if (!isCallingRef.current) return;
        setTranscript(prev => [...prev, { role: 'coach', message: data.response, timestamp: new Date() }]);
        speakOutLoud(data.response);
      }
    } catch (e) {
      if (!isCallingRef.current) return;
      speakOutLoud("I am encountering an error.");
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 shadow-inner">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
            <Headphones size={20} className={callStatus === 'DIALING' ? 'animate-spin' : ''} />
          </div>
          <h4 className="font-display font-black text-sm text-white uppercase tracking-tight">Interactive Mentorship</h4>
        </div>

        <div>
          {isCalling ? (
            <button
              onClick={stopVoiceCall}
              className="px-3 py-1.5 text-xs bg-rose-600 hover:bg-rose-500 text-white font-mono rounded-lg border border-rose-500 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <PhoneOff size={13} />
              HANG UP
            </button>
          ) : (
            <button
              onClick={startVoiceCall}
              className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-550 text-white font-mono font-bold rounded-lg border border-indigo-500 shadow-lg hover:translate-y-[-1px] transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Phone size={13} className="animate-pulse" />
              START CALL
            </button>
          )}
        </div>
      </div>

      {isCalling && (
        <div className="mt-6 space-y-4">
          <div className="bg-slate-900/90 border border-slate-805 p-4 rounded-xl flex flex-col items-center justify-center relative overflow-hidden">
            <div className="h-16 flex items-center justify-center gap-1 w-full">
              {waveHeight.map((h, i) => (
                <div 
                  key={i} 
                  style={{ height: `${h}px` }}
                  className={`w-1 rounded-full transition-all duration-100 ${
                    callStatus === 'SPEAKING' ? 'bg-indigo-400 shadow-[0_0_4px_rgba(99,102,241,0.5)]' :
                    callStatus === 'LISTENING' ? 'bg-rose-400' :
                    callStatus === 'THINKING' ? 'bg-amber-400' :
                    'bg-slate-700'
                  }`}
                />
              ))}
            </div>
            
             <div className="flex items-center gap-4 mt-2">
                <Mic size={18} className={callStatus === 'LISTENING' ? "text-rose-400 animate-pulse" : "text-slate-500"} />
                <p className="text-xs font-bold text-white font-mono">
                  {callStatus === 'SPEAKING' ? 'Speaking...' :
                   callStatus === 'LISTENING' ? 'Listening...' :
                   callStatus === 'THINKING' ? 'Thinking...' :
                   'Connected'}
                </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
