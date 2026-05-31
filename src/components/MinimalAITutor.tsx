import React, { useState, useRef, useEffect } from 'react';
import { Send, Phone, Mic, PhoneOff, Sparkles, AlertTriangle } from 'lucide-react';
import { ChatMessage } from '../types';

export default function MinimalAITutor() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [currentAIResponse, setCurrentAIResponse] = useState('');
  
  const recognitionRef = useRef<any>(null);
  const isCallActiveRef = useRef<boolean>(false);
  const isThinkingRef = useRef<boolean>(false);
  const currentAIResponseRef = useRef<string>('');
  
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  useEffect(() => {
    // Initial welcome message
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: '### Welcome to the Sniper AI Tutor 🎯\n\nI am connected to the live system engine. I know exactly what the bots are watching, trading, and executing. Ask me anything about the strategy, a specific market, or live trades!',
        timestamp: new Date().toISOString()
      }
    ]);
  }, []);

  const speakText = (text: string, onEndCallback?: () => void) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // Stop any ongoing speech
      const cleanText = text.replace(/[#*`_]/g, ''); // Remove markdown for speech
      const utterance = new SpeechSynthesisUtterance(cleanText);
      if (onEndCallback) {
        utterance.onend = onEndCallback;
        utterance.onerror = onEndCallback;
      }
      window.speechSynthesis.speak(utterance);
    } else {
      if (onEndCallback) onEndCallback();
    }
  };

  const sendMessage = async (text: string, currentHistory: ChatMessage[], fromVoice: boolean = false) => {
    if (!text.trim() || isThinkingRef.current) return;
    
    // Interruption logic: If we are talking and the AI is currently speaking, shut it up!
    if (fromVoice && window.speechSynthesis?.speaking) {
      window.speechSynthesis.cancel();
    }

    isThinkingRef.current = true;
    setIsThinking(true);
    setCurrentAIResponse('');
    currentAIResponseRef.current = '';

    const userMsg: ChatMessage = { id: `usr-${Date.now()}`, role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, history: [...currentHistory, userMsg] })
      });
      const data = await res.json();
      
      if (data.success) {
        setMessages(prev => [...prev, {
          id: `ast-${Date.now()}`, role: 'assistant', content: data.response, timestamp: new Date().toISOString()
        }]);
        if (fromVoice && isCallActiveRef.current) {
          setCurrentAIResponse(data.response);
          currentAIResponseRef.current = data.response;
          speakText(data.response);
        }
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: 'assistant', content: `Sorry, I encountered an error: ${err.message}`, timestamp: new Date().toISOString()
      }]);
    } finally {
      isThinkingRef.current = false;
      setIsThinking(false);
    }
  };

  useEffect(() => {
    let recognition: any = null;
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = true; // Stay on continuously to listen for interruptions
      recognition.interimResults = false;
      
      recognition.onresult = (event: any) => {
        const result = event.results[event.results.length - 1];
        if (result.isFinal) {
          const transcript = result[0].transcript.trim();
          if (transcript && isCallActiveRef.current) {
            
            // Echo prevention: if AI is speaking, and the mic picks up exactly what it's saying, ignore it!
            if (window.speechSynthesis?.speaking && currentAIResponseRef.current) {
               const cleanTranscript = transcript.toLowerCase().replace(/[^\w\s]/g, '');
               const cleanAI = currentAIResponseRef.current.toLowerCase().replace(/[^\w\s]/g, '');
               if (cleanAI.includes(cleanTranscript) || cleanTranscript.includes(cleanAI)) {
                  console.log("Echo detected, ignoring...");
                  return; 
               }
            }

            setMessages(prev => {
              sendMessage(transcript, prev, true);
              return prev;
            });
          }
        }
      };
      
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed') {
          setIsCalling(false);
          isCallActiveRef.current = false;
        }
      };
      
      recognition.onend = () => {
        // Because continuous = true, if it stops randomly, restart if the call is still active
        if (isCallActiveRef.current) {
          try {
            recognition.start();
          } catch (e) {
            // Ignore if it's already started
          }
        }
      };
    }
    
    return () => {
      // Cleanup when component unmounts (e.g. closing the window)
      isCallActiveRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.onend = null; // Prevent restart loop
        recognitionRef.current.stop();
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const toggleCall = () => {
    if (isCalling) {
      isCallActiveRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsCalling(false);
      window.speechSynthesis?.cancel();
    } else {
      if (recognitionRef.current) {
        try {
          isCallActiveRef.current = true;
          recognitionRef.current.start();
          setIsCalling(true);
        } catch (e) {
          console.error("Microphone access error:", e);
        }
      } else {
        alert("Speech recognition is not supported in this browser.");
      }
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isThinkingRef.current) return;
    
    const textToSend = input.trim();
    setInput('');
    await sendMessage(textToSend, messages);
  };

  const formatTutorMessage = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      if (line.startsWith('### ')) return <h3 key={idx} className="font-bold text-indigo-400 text-sm mt-3 mb-1">{line.replace('### ', '')}</h3>;
      if (line.startsWith('## ')) return <h2 key={idx} className="font-bold text-indigo-300 text-base mt-4 mb-2">{line.replace('## ', '')}</h2>;
      if (line.startsWith('- ') || line.startsWith('* ')) return <li key={idx} className="ml-4 list-disc text-[13px] text-slate-300 mb-1 leading-relaxed">{parseInlineStyles(line.replace(/^[-*]\s+/, ''))}</li>;
      if (/^\d+\.\s+/.test(line)) return <div key={idx} className="flex gap-2 text-[13px] text-slate-300 mb-1 ml-1"><span className="font-bold text-indigo-400">{line.match(/^\d+/)![0]}.</span><span>{parseInlineStyles(line.replace(/^\d+\.\s+/, ''))}</span></div>;
      if (!line.trim()) return <div key={idx} className="h-2" />;
      return <p key={idx} className="text-[13px] text-slate-300 leading-relaxed mb-2">{parseInlineStyles(line)}</p>;
    });
  };

  const parseInlineStyles = (content: string) => {
    const parts = content.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i} className="text-indigo-300 font-semibold">{part.slice(2, -2)}</strong> : part);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-900/50 backdrop-blur flex justify-between items-center z-10 relative">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="font-display font-black text-slate-100 text-lg tracking-tight">AI Tutor & Analyst</h2>
            <p className="text-[11px] text-slate-400 font-mono">Live Context Audio/Chat Interface</p>
          </div>
        </div>

        <button 
          onClick={toggleCall}
          className={`px-4 py-2 rounded-xl flex items-center gap-2 font-bold text-xs uppercase tracking-wider transition-all shadow-lg ${
            isCalling 
              ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/20' 
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'
          }`}
        >
          {isCalling ? (
            <><PhoneOff size={14} /> End Call</>
          ) : (
            <><Phone size={14} /> Call Tutor</>
          )}
        </button>
      </div>

      {isCalling && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-20 flex flex-col items-center justify-center">
           <div className="relative w-32 h-32 mb-8 flex items-center justify-center">
             <div className="absolute inset-0 bg-indigo-500/20 rounded-full animate-ping" style={{ animationDuration: '2s' }} />
             <div className="absolute inset-4 bg-indigo-500/40 rounded-full animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
             <div className="relative bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-full shadow-[0_0_30px_rgba(99,102,241,0.6)] border-2 border-white/20">
               <Mic size={40} className="text-white animate-pulse" />
             </div>
           </div>
           <h3 className="text-2xl font-display font-black text-white mb-2">Connected to AI Tutor</h3>
           <p className="text-indigo-300 font-mono text-sm animate-pulse max-w-lg text-center mt-4 h-20 overflow-y-auto">
             {isThinking ? "AI is thinking... (and will speak shortly)" : currentAIResponse ? `AI: ${currentAIResponse}` : "Listening... speak your question."}
           </p>
           
           <button 
             onClick={toggleCall}
             className="mt-12 px-6 py-3 bg-rose-600 hover:bg-rose-500 rounded-xl text-white font-bold flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all"
           >
             <PhoneOff size={18} /> Hang Up
           </button>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 relative z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/5 via-slate-950 to-slate-950 pointer-events-none" />
        
        {messages.map(msg => {
          const isTutor = msg.role === 'assistant';
          return (
            <div key={msg.id} className={`flex ${isTutor ? 'justify-start' : 'justify-end'} relative z-10`}>
              <div className={`p-4 max-w-[85%] sm:max-w-[75%] rounded-2xl ${
                isTutor 
                  ? 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-sm shadow-md' 
                  : 'bg-indigo-600 border border-indigo-500 text-white rounded-tr-sm shadow-lg shadow-indigo-600/20'
              }`}>
                <div className="flex items-center gap-2 mb-2 pb-1 border-b border-white/10 text-[10px] font-mono opacity-80 uppercase tracking-widest">
                   {isTutor ? <><Sparkles size={12} className="text-indigo-400" /> System Analyst</> : 'You'}
                </div>
                <div className="text-sm">
                  {isTutor ? formatTutorMessage(msg.content) : msg.content}
                </div>
              </div>
            </div>
          );
        })}

        {isThinking && (
          <div className="flex justify-start relative z-10">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl rounded-tl-sm flex items-center gap-3">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]" />
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s]" />
              <span className="text-xs text-slate-500 font-mono ml-2">Analyzing engine data...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-4 bg-slate-900/80 border-t border-slate-800 backdrop-blur relative z-10">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={isThinking || isCalling}
            placeholder="Ask about live trades, strategies, or specific markets..."
            className="flex-1 bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition-colors"
          />
          <button
            type="submit"
            disabled={!input.trim() || isThinking || isCalling}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white p-3 rounded-xl flex items-center justify-center transition-colors shadow-lg"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

