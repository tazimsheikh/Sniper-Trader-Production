import React from 'react';
import { motion } from 'motion/react';
import { Target, TrendingUp, ShieldCheck, Cpu, Zap, BarChart2, ShieldAlert, Crosshair } from 'lucide-react';

export default function AboutSection() {
  const features = [
    {
      icon: Cpu,
      title: 'Layer 1: The Recon AI',
      description: 'The market is a chaotic, noisy place. Our Recon AI acts as the scout, relentlessly scanning global markets 24/5. It ignores the "noise" of amateur traders and looks purely for the hidden footprints left by massive institutions and central banks.',
    },
    {
      icon: Crosshair,
      title: 'Layer 2: The Sniper Bots',
      description: 'Once a high-probability target is locked, the Sniper Bots take over. Emotionless and mathematically precise, they execute trades at the exact microsecond the price hits our predetermined liquidity zones. No fear, no hesitation.',
    },
    {
      icon: ShieldAlert,
      title: 'Layer 3: The Circuit Breakers',
      description: 'What happens when a sudden war breaks out or a central bank surprises the world? The Circuit Breaker AI instantly detects market abnormalities, freezing trades and pulling your money to safety before a crash can wipe out your account.',
    },
    {
      icon: ShieldCheck,
      title: 'The Impenetrable Shield',
      description: 'By layering these AIs and autonomous bots on top of each other, the system acts like a vault. It filters out market manipulation, evades sudden "flash crashes," and protects your capital like a digital bodyguard.',
    },
    {
      icon: TrendingUp,
      title: 'Asymmetric Compounding',
      description: 'We don’t gamble; we calculate. By strictly risking small amounts to target massive rewards, the math is designed so that a single sniper strike can pay for multiple minor losses and then some.',
    },
    {
      icon: BarChart2,
      title: 'Your Personal Tutor',
      description: 'You aren\'t left in the dark. An onboard AI Tutor sits beside you, explaining exactly why the bots are making their moves in plain, simple English, turning you into a market master over time.',
    },
  ];

  return (
    <div className="text-slate-300 pb-8">
      <div className="mb-12 text-center max-w-4xl mx-auto pt-4">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center justify-center p-3 mb-6 bg-gradient-to-br from-[#d4af37]/20 to-[#8a7322]/5 rounded-2xl border border-[#d4af37]/30 shadow-[0_0_30px_rgba(212,175,55,0.15)]"
        >
          <Target size={32} className="text-[#d4af37]" />
        </motion.div>
        
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-4xl sm:text-5xl font-display font-black tracking-tight text-white uppercase mb-4"
        >
          The <span className="text-[#d4af37]">Sniper Trader</span> Machine
        </motion.h1>
        
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-inner mb-8 text-left"
        >
          <p className="text-slate-300 text-lg sm:text-xl leading-relaxed font-light mb-4">
            The financial market isn't a playground—it's a battlefield controlled by massive banks with billion-dollar algorithms designed to take your money. 
          </p>
          <p className="text-slate-300 text-lg sm:text-xl leading-relaxed font-light mb-4">
            To survive and thrive, you can't fight them with human emotions. You need a machine. 
          </p>
          <p className="text-[#d4af37] text-lg sm:text-xl leading-relaxed font-bold">
            Created and engineered by <span className="text-white uppercase tracking-widest bg-slate-950 px-2 py-1 rounded">Tazim Sheikh</span>, the Sniper Trader platform is your ultimate equalizer. It isn't just one bot—it is an intricate, layered ecosystem of specialized AIs working in perfect harmony to safeguard your capital and extract profit from the chaos.
          </p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {features.map((feature, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
            className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 hover:bg-slate-800/60 hover:border-[#d4af37]/50 transition-all duration-300 group shadow-lg hover:shadow-[0_0_25px_rgba(212,175,55,0.1)] relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#d4af37]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative z-10">
              <div className="w-12 h-12 bg-slate-950/80 rounded-xl border border-slate-800 flex items-center justify-center mb-5 group-hover:border-[#d4af37]/50 group-hover:scale-110 transition-all duration-300 shadow-inner">
                <feature.icon size={24} className="text-slate-400 group-hover:text-[#d4af37] transition-colors" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3 tracking-wide">{feature.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.9 }}
        className="mt-16 bg-gradient-to-r from-[#d4af37]/10 via-[#d4af37]/5 to-transparent border border-[#d4af37]/20 rounded-3xl p-8 sm:p-12 text-center relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-40 h-40 bg-[#d4af37] rounded-full blur-[80px] opacity-20" />
        <div className="absolute bottom-0 left-0 -mb-10 -ml-10 w-40 h-40 bg-emerald-500 rounded-full blur-[80px] opacity-10" />
        
        <h2 className="text-2xl sm:text-3xl font-display font-black text-white uppercase tracking-tight mb-4 relative z-10">
          The Ultimate Fortress
        </h2>
        <p className="text-slate-300 max-w-2xl mx-auto text-lg leading-relaxed relative z-10">
          Imagine navigating a minefield, but you have a drone mapping the safe paths, a bomb squad disarming the traps in real-time, and a sniper taking out threats before they ever reach you. That is what Tazim Sheikh’s system does for your money in the financial markets. It’s not just trading; it’s automated mathematical warfare.
        </p>
      </motion.div>
    </div>
  );
}
