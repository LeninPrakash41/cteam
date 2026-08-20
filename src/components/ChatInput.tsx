import React, { useState, useEffect } from 'react';
import { Send, Paperclip, X, Mic } from 'lucide-react';
import { Message, Agent } from '../types';

interface ChatInputProps {
  handleSubmit: (e: React.FormEvent, input: string) => Promise<void>;
  loading: boolean;
  file: File | null;
  fileContent: string;
  replyingTo: Message | null;
  editingMessage: Message | null;
  cancelAction: () => void;
  clearFile: () => void;
  team: Agent[];
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  toggleVoiceMode: () => void;
  suggestedInput?: string;
}

export const ChatInput = React.memo(({
  handleSubmit,
  loading,
  file,
  fileContent,
  replyingTo,
  editingMessage,
  cancelAction,
  clearFile,
  team,
  handleFileChange,
  toggleVoiceMode,
  suggestedInput
}: ChatInputProps) => {
  const [input, setInput] = useState('');
  const [showTagMenu, setShowTagMenu] = useState(false);

  useEffect(() => {
    if (editingMessage) {
      setInput(editingMessage.text);
    }
  }, [editingMessage]);

  useEffect(() => {
    if (suggestedInput) {
      setInput(suggestedInput);
    }
  }, [suggestedInput]);

  useEffect(() => {
    if (input.endsWith('@')) {
      setShowTagMenu(true);
    } else if (showTagMenu && !input.includes('@')) {
      setShowTagMenu(false);
    }
  }, [input, showTagMenu]);

  const tagAgent = (agentName: string) => {
    setInput(prev => prev.replace(/@$/, '') + `@${agentName} `);
    setShowTagMenu(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSubmit(e, input);
    setInput('');
  };

  return (
    <div className="bg-white border-t border-zinc-200 p-6 flex-shrink-0">
      <div className="max-w-4xl mx-auto">
        {(file || replyingTo || editingMessage) && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-zinc-100 rounded-lg w-fit">
            {file && (
              <div className="flex items-center gap-1">
                <Paperclip className="w-4 h-4 text-zinc-500" />
                <span className="text-xs font-semibold text-zinc-600">{file.name}</span>
                <button onClick={clearFile} className="p-1 hover:bg-zinc-200 rounded-full text-zinc-500">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {(replyingTo || editingMessage) && (
              <div className="flex items-center gap-1">
                {replyingTo && <span className="text-xs font-semibold text-indigo-600">Replying to: {replyingTo.text.substring(0, 20)}...</span>}
                {editingMessage && <span className="text-xs font-semibold text-amber-600">Editing message...</span>}
                <button onClick={cancelAction} className="p-1 hover:bg-zinc-200 rounded-full text-zinc-500">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
        <form onSubmit={onSubmit} className="relative flex items-center gap-2">
          {showTagMenu && (
            <div className="absolute bottom-full left-0 mb-2 bg-white border border-zinc-200 rounded-lg shadow-lg p-2 z-50">
              {team.map(agent => (
                <button type="button" key={agent.id} onClick={() => tagAgent(agent.name)} className="block w-full text-left px-3 py-2 hover:bg-zinc-100 rounded text-sm">
                  @{agent.name}
                </button>
              ))}
            </div>
          )}
          <div className="relative flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Address the board or paste a link..."
                disabled={loading}
                className="w-full bg-zinc-50 border border-zinc-300 rounded-full pl-6 pr-12 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all disabled:opacity-50"
              />
              <label className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors">
                <input type="file" className="sr-only" onChange={handleFileChange} disabled={loading} accept=".docx,.pdf,.txt,.md,.csv,.json" />
                <Paperclip className="w-5 h-5" />
              </label>
            </div>
            <button
              type="button"
              onClick={toggleVoiceMode}
              className="w-12 h-12 flex-shrink-0 bg-white border border-zinc-200 text-zinc-600 rounded-full flex items-center justify-center hover:bg-zinc-50 transition-colors shadow-sm"
              title="Start Voice Discussion"
            >
              <Mic className="w-5 h-5" />
            </button>
          </div>
          <button
            type="submit"
            disabled={(!input.trim() && !fileContent) || loading}
            className="w-12 h-12 flex-shrink-0 bg-zinc-900 text-white rounded-full flex items-center justify-center hover:bg-zinc-800 disabled:opacity-50 disabled:hover:bg-zinc-900 transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
        <p className="text-xs text-center text-zinc-400 mt-3">
          AI executives provide simulated advice. Always verify critical business decisions.
        </p>
      </div>
    </div>
  );
});
