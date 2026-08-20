import React, { useState } from 'react';
import { useCSuite } from '../store';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, Plus, CheckCircle2, XCircle, Clock, Award, Download, Trash2, Filter, Sparkles, UserCheck } from 'lucide-react';
import { BoardResolution, ResolutionVote } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { saveAs } from 'file-saver';

export function Resolutions() {
  const { company, team, resolutions, addResolution, updateResolution, deleteResolution } = useCSuite();
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    category: 'Strategic' as BoardResolution['category'],
    content: ''
  });

  const handleOpenModal = () => {
    setFormData({
      title: '',
      category: 'Strategic',
      content: `WHEREAS the Executive Board has thoroughly evaluated the proposed strategic initiative;\n\nRESOLVED THAT the Board hereby authorizes and directs management to execute the plan in accordance with corporate standards.`
    });
    setIsModalOpen(true);
  };

  const handleCreateResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company || !formData.title.trim()) return;

    const year = new Date().getFullYear();
    const num = Math.floor(100 + Math.random() * 900);
    const resolutionNumber = `RES-${year}-${num}`;

    // Collect automated voting from C-Suite team
    const votes: ResolutionVote[] = (team || []).map(agent => ({
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      vote: 'In Favor',
      comment: `Approved after evaluating strategic alignment and operational impact.`
    }));

    const newRes: BoardResolution = {
      id: uuidv4(),
      companyId: company.id,
      resolutionNumber,
      title: formData.title,
      category: formData.category,
      content: formData.content,
      proposedBy: 'Founder',
      status: 'Passed',
      votes,
      passedAt: Date.now(),
      createdAt: Date.now()
    };

    await addResolution(newRes);
    setIsModalOpen(false);
  };

  const handleDownloadResolution = (res: BoardResolution) => {
    const text = `====================================================
OFFICIAL CORPORATE BOARD RESOLUTION
Company: ${company?.name || 'CSuite AI'}
Resolution No: ${res.resolutionNumber}
Category: ${res.category}
Date Passed: ${new Date(res.passedAt || res.createdAt).toLocaleDateString()}
====================================================

TITLE: ${res.title}

RESOLUTION CLAUSES:
${res.content}

C-SUITE VOTING & EXECUTIVE SIGNATURES:
${res.votes.map(v => `- ${v.agentName} (${v.agentRole}): ${v.vote.toUpperCase()} — "${v.comment || 'Approved'}"`).join('\n')}

CERTIFICATION:
I hereby certify that the above is a true and correct copy of the resolution duly passed by the Board of Directors.

___________________________________
Founder & Board Chair
`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `${res.resolutionNumber}_${res.title.replace(/[^a-zA-Z0-9]/g, '_')}.txt`);
  };

  const filteredResolutions = resolutions.filter(res => {
    const matchCategory = filterCategory === 'All' || res.category === filterCategory;
    const matchStatus = filterStatus === 'All' || res.status === filterStatus;
    return matchCategory && matchStatus;
  });

  const passedCount = resolutions.filter(r => r.status === 'Passed').length;
  const draftCount = resolutions.filter(r => r.status === 'Draft').length;

  return (
    <div className="flex-1 overflow-y-auto p-8 font-sans">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 tracking-tight mb-2 flex items-center gap-3">
              <Award className="w-8 h-8 text-indigo-600" />
              Board Resolutions
            </h1>
            <p className="text-zinc-500">Official corporate resolutions voted and signed by your C-Suite Board of Directors.</p>
          </div>

          <button
            onClick={handleOpenModal}
            className="flex items-center gap-2 px-5 py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-colors shadow-sm w-fit"
          >
            <Plus className="w-4 h-4" />
            Pass New Board Resolution
          </button>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">Total Resolutions</p>
              <p className="text-2xl font-bold text-zinc-900">{resolutions.length}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">Passed & Enacted</p>
              <p className="text-2xl font-bold text-zinc-900">{passedCount}</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-xs flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-500">Draft / Under Review</p>
              <p className="text-2xl font-bold text-zinc-900">{draftCount}</p>
            </div>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 bg-white p-4 rounded-xl border border-zinc-200 shadow-xs">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Filter By Category:</span>
            <div className="flex flex-wrap gap-1.5 ml-2">
              {['All', 'Strategic', 'Financial', 'Governance', 'Operational', 'HR & Compensation'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filterCategory === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Status:</span>
            <div className="flex gap-1.5">
              {['All', 'Passed', 'Draft'].map(st => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filterStatus === st
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Resolutions List */}
        {filteredResolutions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-12 text-center shadow-xs my-8 max-w-xl mx-auto">
            <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-indigo-600">
              <Award className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">No Board Resolutions Found</h3>
            <p className="text-zinc-500 text-sm mb-6">
              Create formal board resolutions or ask your C-Suite during Boardroom discussions to pass resolutions on strategic decisions.
            </p>
            <button
              onClick={handleOpenModal}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              Pass First Board Resolution
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredResolutions.map((res, i) => (
              <motion.div
                key={res.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-xs hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-zinc-100">
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-mono font-bold">
                      {res.resolutionNumber}
                    </span>
                    <span className="px-2.5 py-1 bg-zinc-100 text-zinc-700 rounded-lg text-xs font-medium">
                      {res.category}
                    </span>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      res.status === 'Passed'
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                    }`}>
                      {res.status === 'Passed' ? 'Passed & Enacted' : 'Draft'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDownloadResolution(res)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 rounded-lg text-xs font-semibold transition-colors"
                      title="Download Official Certificate"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Certificate
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Are you sure you want to delete resolution "${res.title}"?`)) {
                          deleteResolution(res.id);
                        }
                      }}
                      className="p-1.5 text-zinc-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                      title="Delete Resolution"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <h3 className="text-xl font-bold text-zinc-900 mb-3">{res.title}</h3>
                
                <div className="bg-zinc-50 border border-zinc-200/80 rounded-xl p-4 mb-6 text-sm text-zinc-700 leading-relaxed font-mono whitespace-pre-wrap">
                  {res.content}
                </div>

                {/* Voting Matrix */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-indigo-500" />
                    C-Suite Voting & Executive Rationale ({res.votes.length} Votes)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {res.votes.map((v, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 bg-zinc-50/50 rounded-xl border border-zinc-200/60">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-bold text-zinc-900 truncate">{v.agentName}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              v.vote === 'In Favor' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {v.vote}
                            </span>
                          </div>
                          <span className="text-[11px] text-indigo-600 font-semibold block mb-1">{v.agentRole}</span>
                          {v.comment && (
                            <p className="text-xs text-zinc-500 italic">"{v.comment}"</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* New Resolution Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl border border-zinc-200 p-6 max-w-2xl w-full shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-100">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-zinc-900">Pass Board Resolution</h2>
                    <p className="text-xs text-zinc-500">Draft a formal resolution for C-Suite board voting</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 p-1">
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateResolution} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Resolution Title
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g. Resolution to Authorize Series A Fundraising Strategy"
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Category
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Strategic">Strategic</option>
                    <option value="Financial">Financial</option>
                    <option value="Governance">Governance</option>
                    <option value="Operational">Operational</option>
                    <option value="HR & Compensation">HR & Compensation</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 mb-1">
                    Resolution Clauses & Content
                  </label>
                  <textarea
                    rows={6}
                    required
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl p-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-5 py-2.5 bg-zinc-100 text-zinc-700 rounded-xl text-sm font-semibold hover:bg-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-xs flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    Enact Resolution
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
