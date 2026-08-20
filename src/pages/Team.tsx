import React, { useState } from 'react';
import { useCSuite } from '../store';
import { AgentCard } from '../components/AgentCard';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Users, Loader2, Sparkles, Plus } from 'lucide-react';
import { generateTeam } from '../services/ai';
import { apiFetch } from '../db';
import { v4 as uuidv4 } from 'uuid';

export function Team() {
  const { company, companyLoading, team, setTeam, setCompany, user } = useCSuite();
  const navigate = useNavigate();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateFallbackTeam = async () => {
    setIsGenerating(true);
    try {
      let currentCompany = company;
      if (!currentCompany && user) {
        const companyId = uuidv4();
        currentCompany = {
          id: companyId,
          ownerId: user.uid,
          name: 'CSuite AI Startup',
          industry: 'Technology',
          category: 'Artificial Intelligence',
          description: 'A cutting-edge tech startup utilizing AI executive board members for strategic decision making.',
          createdAt: new Date().toISOString()
        };
        await apiFetch('/api/companies', {
          method: 'POST',
          body: JSON.stringify(currentCompany)
        });
        setCompany(currentCompany);
      }

      if (currentCompany) {
        const generatedTeam = await generateTeam(
          currentCompany.industry || 'Technology',
          currentCompany.category || 'Artificial Intelligence',
          currentCompany.name || 'Startup'
        );

        const teamWithIds = generatedTeam.map(agent => ({
          ...agent,
          companyId: currentCompany!.id,
          createdAt: new Date().toISOString()
        }));

        await apiFetch(`/api/companies/${currentCompany.id}/agents`, {
          method: 'POST',
          body: JSON.stringify({ agents: teamWithIds })
        });

        setTeam(teamWithIds);
      }
    } catch (error) {
      console.error("Failed to assemble C-Suite team", error);
      alert("Failed to assemble team. Please check your AI API credentials or try onboarding.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (companyLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <header className="mb-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 tracking-tight mb-2">The Board</h1>
            <p className="text-zinc-500">Your specialized executive team with 28 years of experience.</p>
          </div>

          {team.length > 0 && (
            <button
              onClick={handleGenerateFallbackTeam}
              disabled={isGenerating}
              className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50 w-fit"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Regenerating Team...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  Regenerate Executive Board
                </>
              )}
            </button>
          )}
        </header>

        {team.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200 p-12 text-center shadow-sm max-w-xl mx-auto my-12">
            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-indigo-600">
              <Users className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900 mb-2">No C-Suite Board Assembled Yet</h2>
            <p className="text-zinc-500 mb-8 leading-relaxed">
              Assemble your specialized executive board to unlock AI-powered strategic advice, boardroom discussions, and business planning.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <button
                onClick={handleGenerateFallbackTeam}
                disabled={isGenerating}
                className="flex items-center justify-center gap-2 px-6 py-3.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Assembling Team...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Auto-Generate Board
                  </>
                )}
              </button>
              <button
                onClick={() => navigate('/onboarding')}
                className="flex items-center justify-center gap-2 px-6 py-3.5 bg-zinc-100 text-zinc-900 rounded-xl font-semibold hover:bg-zinc-200 transition-colors"
              >
                <Plus className="w-5 h-5" />
                Custom Onboarding
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {team.map((agent, i) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <AgentCard agent={agent} />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
