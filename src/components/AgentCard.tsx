import React, { useState } from 'react';
import { Agent } from '../types';
import { useCSuite } from '../store';
import { RefreshCw, UserCheck } from 'lucide-react';

export function AgentCard({ agent }: { agent: Agent }) {
  const { updateAgent } = useCSuite();
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleRegenerateAvatar = async () => {
    setIsRegenerating(true);
    try {
      // Generate a new random seed for the avatar using DiceBear / Picsum
      const seeds = ['micah', 'avataaars', 'bottts', 'personas', 'lorelei'];
      const randomStyle = seeds[Math.floor(Math.random() * seeds.length)];
      const newSeed = Math.random().toString(36).substring(7);
      const newAvatarUrl = `https://api.dicebear.com/7.x/${randomStyle}/svg?seed=${newSeed}`;
      
      await updateAgent(agent.id, { avatarUrl: newAvatarUrl });
    } catch (error) {
      console.error("Failed to regenerate avatar", error);
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
      <div>
        <div className="flex items-start gap-4 mb-4">
          <div className="flex flex-col items-center">
            <div className="relative group cursor-pointer" onClick={handleRegenerateAvatar}>
              <img
                src={agent.avatarUrl}
                alt={agent.name}
                className="w-16 h-16 rounded-full object-cover border border-zinc-200 bg-zinc-50 shadow-inner"
                referrerPolicy="no-referrer"
              />
              <div 
                className="absolute inset-0 flex items-center justify-center bg-black/40 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                title="Click to Regenerate Avatar"
              >
                <RefreshCw className={`w-5 h-5 ${isRegenerating ? 'animate-spin' : ''}`} />
              </div>
            </div>
            
            {/* Explicit Regenerate Avatar button */}
            <button
              onClick={handleRegenerateAvatar}
              disabled={isRegenerating}
              className="mt-2 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 disabled:opacity-50"
              title="Regenerate Avatar"
            >
              <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
              Regenerate
            </button>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-zinc-900 truncate">{agent.name}</h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                <UserCheck className="w-3 h-3" />
                Executive
              </span>
            </div>
            <p className="text-sm font-semibold text-indigo-600 mb-2">{agent.role}</p>
            <p className="text-sm text-zinc-600 leading-relaxed line-clamp-4">{agent.bio}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-100">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Core Expertise</h4>
          <div className="flex flex-wrap gap-1.5">
            {agent.expertise.map((exp, idx) => (
              <span
                key={idx}
                className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-700 border border-zinc-200/60"
              >
                {exp}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
