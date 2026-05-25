import React, { useRef, useEffect, useState } from 'react';
import { ChatMessage, TrapSignal } from '../types';
import { Sparkles, MessageSquare, Send, BookOpen, Shield, TrendingUp, X, Award, HelpCircle } from 'lucide-react';

interface TutorPanelProps {
  messages: ChatMessage[];
  activeSignal: TrapSignal | null;
  onClearSignalContext: () => void;
  onSendMessage: (text: string) => void;
  isThinking: boolean;
}

export default function TutorPanel({
  messages,
  activeSignal,
  onClearSignalContext,
  onSendMessage,
  isThinking,
}: TutorPanelProps) {
  const [input, setInput] = useState('');
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Auto scroll to chat bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isThinking) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleQuickQuestion = (question: string) => {
    if (isThinking) return;
    onSendMessage(question);
  };

  // Helper to format simple markdown elements (bold, bullets, sections) safely without extra imports
  const formatTutorMessage = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      // Headers
      if (line.startsWith('### ')) {
        return (
          <h4 key={idx} className="font-display font-semibold text-slate-100 text-[14px] mt-3 mb-1.5 border-b border-slate-800/85 pb-1 flex items-center gap-1.5">
            <span className="w-1.5 h-3 bg-indigo-550 rounded-sm" />
            {line.replace('### ', '')}
          </h4>
        );
      }
      if (line.startsWith('## ')) {
        return (
          <h3 key={idx} className="font-display font-bold text-indigo-400 text-[15px] mt-4 mb-2 flex items-center gap-1.5">
            {line.replace('## ', '')}
          </h3>
        );
      }
      if (line.startsWith('# ')) {
        return (
          <h2 key={idx} className="font-display font-extrabold text-indigo-500 text-[16px] mt-4 mb-2">
            {line.replace('# ', '')}
          </h2>
        );
      }

      // Bullets
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const cleanContent = line.replace(/^[-*]\s+/, '');
        return (
          <li key={idx} className="ml-4 list-disc text-xs text-slate-300 leading-relaxed mb-1.5">
            {parseInlineStyles(cleanContent)}
          </li>
        );
      }

      // Ordered list numbered
      if (/^\d+\.\s+/.test(line)) {
        const cleanContent = line.replace(/^\d+\.\s+/, '');
        const num = line.match(/^\d+/)![0];
        return (
          <div key={idx} className="flex gap-2 text-xs text-slate-300 leading-relaxed mb-1.5 ml-1">
            <span className="font-bold text-indigo-400 font-mono">{num}.</span>
            <span>{parseInlineStyles(cleanContent)}</span>
          </div>
        );
      }

      // Empty Lines
      if (!line.trim()) {
        return <div key={idx} className="h-2" />;
      }

      return (
        <p key={idx} className="text-xs text-slate-300 leading-relaxed mb-2">
          {parseInlineStyles(line)}
        </p>
      );
    });
  };

  const parseInlineStyles = (content: string) => {
    // Regex matching bold **text**
    const parts = content.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="text-indigo-300 font-semibold">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-[650px] relative">
      {/* Header */}
      <div className="p-4 bg-slate-950 border-b border-slate-800/65 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
            <Sparkles size={16} />
          </div>
          <div>
            <h2 className="font-display font-bold text-slate-100 text-sm">Smart Money AI Mentor</h2>
            <p className="text-[10px] text-slate-500 font-mono">SNIPER STRATEGY COACH</p>
          </div>
        </div>

        {activeSignal && (
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-850 px-2 py-1 rounded-lg">
            <span className="text-[10px] font-bold text-indigo-400 font-mono truncate max-w-[120px]">
              Analyzing: {activeSignal.displayName}
            </span>
            <button
               onClick={onClearSignalContext}
               className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
               title="Clear Signal Focus"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      {/* active Signal Playbook Box */}
      {activeSignal && (
        <div className="bg-gradient-to-r from-indigo-950/15 to-transparent border-b border-slate-800 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <span className="text-[10px] uppercase tracking-wider text-indigo-400 font-bold font-mono">ACTIVE STUDY CASE</span>
              <h3 className="font-display font-bold text-slate-100 text-sm mt-0.5 flex items-center gap-2 flex-wrap">
                {activeSignal.pattern} ({activeSignal.direction})
                {activeSignal.status && (
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                    activeSignal.status === 'Trade Now' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-550/30 font-black animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.15)]' :
                    activeSignal.status === 'Get Ready' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20 font-bold' :
                    activeSignal.status === 'Wait' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/25' :
                    'bg-slate-800/40 text-slate-500 border border-slate-800/70/50 opacity-60'
                  }`}>
                    ● {activeSignal.status}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400 mt-1 lines-clamp-2 leading-relaxed">
                Rejection Level: <span className="text-slate-200 font-bold">{activeSignal.keyLevel.toFixed(2)} ({activeSignal.levelType})</span> during <span className="text-indigo-400 font-bold">{activeSignal.timingGate}</span> clock rotation.
              </p>
            </div>
            <div className="bg-slate-950 px-2 py-1 rounded text-[10px] font-mono border border-slate-800 flex items-center gap-1">
              <Award size={12} className="text-indigo-400" />
              <span className="text-indigo-405 font-bold">{activeSignal.grade}-Star Setup</span>
            </div>
          </div>

          {activeSignal.tutorAnalysis && (
            <div className="mt-3 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 text-[11px]">
              <div className="font-bold text-indigo-300 font-mono">Trapped Retails:</div>
              <p className="text-slate-300 mt-0.5 leading-relaxed">{activeSignal.tutorAnalysis.trappedAudience}</p>
            </div>
          )}
        </div>
      )}

      {/* Chats area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/25">
        {messages.length === 0 ? (
          <div className="text-center py-8 px-4 flex flex-col items-center">
            <MessageSquare size={36} className="text-slate-700 mb-2.5" />
            <h4 className="font-semibold text-slate-300 text-xs">Begin Interactive Mentorship</h4>
            <p className="text-[11px] text-slate-500 mt-1 max-w-sm leading-relaxed">
              Ask questions about smart money traps, the 10:00 AM Club timing window, or click **"Ask AI Tutor"** on any active signal card above to auto-load the coordinate matrix!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isTutor = msg.role === 'assistant';
            return (
              <div
                key={msg.id}
                className={`flex ${isTutor ? 'justify-start' : 'justify-end'}`}
                id={`chat-msg-${msg.id}`}
              >
                <div className={`p-3 max-w-[85%] rounded-xl ${
                  isTutor 
                    ? 'bg-slate-900 border border-slate-800/70 text-slate-100 rounded-tl-none shadow-md' 
                    : 'bg-indigo-600 text-white font-medium rounded-tr-none shadow-md shadow-indigo-650/15'
                }`}>
                  <div className="flex items-center gap-1.5 mb-1.5 border-b pb-1 border-slate-800/20 text-[10px] font-mono font-bold">
                    {isTutor ? (
                      <>
                        <Sparkles size={11} className="text-indigo-400" />
                        <span className="text-indigo-400">SNIPER AI TUTOR</span>
                      </>
                    ) : (
                      <span className="text-indigo-200">STUDENT TRADER</span>
                    )}
                    <span className="ml-auto text-[9px] opacity-60">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {isTutor ? formatTutorMessage(msg.content) : <p className="text-xs leading-relaxed">{msg.content}</p>}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Thinking loader */}
        {isThinking && (
          <div className="flex justify-start">
            <div className="bg-slate-900 border border-slate-800/70 p-3.5 rounded-xl rounded-tl-none max-w-[80%] flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s]" />
              <span className="text-xs text-slate-500 font-mono ml-1">Analyzing Smart Money footprint...</span>
            </div>
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* Playbook study prompts */}
      <div className="p-3 bg-slate-950 border-t border-slate-800">
        <div className="text-[10px] text-slate-500 font-mono uppercase mb-2 flex items-center gap-1 font-semibold">
          <BookOpen size={11} className="text-slate-500" />
          <span>Interactive Playbook Prompt Bank:</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 max-w-full">
          {activeSignal ? (
            <>
              <button
                onClick={() => handleQuickQuestion(`Why did you suggest this ${activeSignal.pattern} trade?`)}
                className="flex-shrink-0 px-2 py-1 text-[10px] bg-slate-900 hover:bg-slate-800 text-indigo-400 border border-slate-800 rounded-lg transition-colors font-medium whitespace-nowrap cursor-pointer"
                disabled={isThinking}
              >
                ❓ Why suggest this?
              </button>
              <button
                onClick={() => handleQuickQuestion(`What are the step by step 1-minute execution steps for this setup on ${activeSignal.displayName}?`)}
                className="flex-shrink-0 px-2 py-1 text-[10px] bg-slate-900 hover:bg-slate-800 text-indigo-400 border border-slate-800 rounded-lg transition-colors font-medium whitespace-nowrap cursor-pointer"
                disabled={isThinking}
              >
                ⏱️ Give 1m execution steps
              </button>
              <button
                onClick={() => handleQuickQuestion(`How should I structure risk and stop-loss on this setup?`)}
                className="flex-shrink-0 px-2 py-1 text-[10px] bg-slate-900 hover:bg-slate-800 text-indigo-400 border border-slate-800 rounded-lg transition-colors font-medium whitespace-nowrap cursor-pointer"
                disabled={isThinking}
              >
                SL Structuring
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handleQuickQuestion('Explain the 20 EMA gatekeeper rule')}
                className="flex-shrink-0 px-2.5 py-1 text-[10px] bg-slate-900 hover:bg-slate-800 text-indigo-400 border border-slate-800 rounded-lg transition-colors font-medium whitespace-nowrap cursor-pointer"
                disabled={isThinking}
              >
                🛡️ 20 EMA Gatekeeper
              </button>
              <button
                onClick={() => handleQuickQuestion('What is the First Red Day (FRD) and how do I map the Strike Zone?')}
                className="flex-shrink-0 px-2.5 py-1 text-[10px] bg-slate-900 hover:bg-slate-800 text-indigo-400 border border-slate-800 rounded-lg transition-colors font-medium whitespace-nowrap cursor-pointer"
                disabled={isThinking}
              >
                📝 First Red Day (FRD)
              </button>
              <button
                onClick={() => handleQuickQuestion('Describe the 50/50 Chop Zone compared to the Outer extremes')}
                className="flex-shrink-0 px-2.5 py-1 text-[10px] bg-slate-900 hover:bg-slate-800 text-indigo-400 border border-slate-800 rounded-lg transition-colors font-medium whitespace-nowrap cursor-pointer"
                disabled={isThinking}
              >
                🚧 50/50 Chop Zone
              </button>
              <button
                onClick={() => handleQuickQuestion('Explain the Inside Day template mechanics')}
                className="flex-shrink-0 px-2.5 py-1 text-[10px] bg-slate-900 hover:bg-slate-800 text-indigo-450 border border-slate-800 rounded-lg transition-colors font-medium whitespace-nowrap cursor-pointer"
                disabled={isThinking}
              >
                📦 Inside Day Setup
              </button>
            </>
          )}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={activeSignal ? "Ask a specific question about this active trap..." : "Ask your trading coach..."}
            className="flex-1 bg-slate-900 border border-slate-805 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/20 text-xs transition-colors"
            id="tutor-chat-input"
            disabled={isThinking}
          />
          <button
            type="submit"
            className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-lg hover:shadow-indigo-600/15 transition-all flex items-center justify-center cursor-pointer"
            id="tutor-chat-send-btn"
            disabled={isThinking || !input.trim()}
          >
            <Send size={13} />
          </button>
        </form>
      </div>
    </div>
  );
}
