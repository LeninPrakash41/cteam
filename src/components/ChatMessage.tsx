import React from 'react';
import { Message, Agent, Proposal, MarketingAsset } from '../types';
import Markdown from 'react-markdown';
import { cn } from './Layout';
import { motion } from 'motion/react';
import { Paperclip, Check, X, Save, Download } from 'lucide-react';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';

interface ChatMessageProps {
  message: Message;
  agent?: Agent;
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onApproveProposal?: (messageId: string, proposal: Proposal) => void;
  onRejectProposal?: (messageId: string, proposal: Proposal) => void;
  onSaveAsset?: (message: Message) => void;
  onPassResolution?: (title: string, content: string) => void;
  isStreaming?: boolean;
}

export function ChatMessage({ message, agent, onReply, onEdit, onApproveProposal, onRejectProposal, onSaveAsset, onPassResolution, isStreaming }: ChatMessageProps) {
  const isUser = message.senderId === 'user';

  const handleDownloadDocx = async () => {
    if (!message.fileContent) return;
    
    const doc = new Document({
      sections: [{
        properties: {},
        children: message.fileContent.split('\n').map(line => new Paragraph({
          children: [new TextRun(line)]
        }))
      }]
    });
    
    const blob = await Packer.toBlob(doc);
    saveAs(blob, message.fileName?.endsWith('.docx') ? message.fileName : `${message.fileName || 'document'}.docx`);
  };

  return (
    <motion.div
      className={cn("flex w-full gap-4 py-4 group", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        <div className="flex-shrink-0">
          <img
            src={agent?.avatarUrl || "https://picsum.photos/seed/ai/200"}
            alt={agent?.name || "AI"}
            className="w-10 h-10 rounded-full object-cover border border-zinc-200"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      
      <div className={cn(
        "flex flex-col max-w-[80%]",
        isUser ? "items-end" : "items-start"
      )}>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-semibold text-zinc-900">
            {isUser ? 'You (Founder)' : agent?.name}
          </span>
          {!isUser && agent && (
            <span className="text-xs font-medium text-indigo-600">
              {agent.role}
            </span>
          )}
          <span className="text-xs text-zinc-400">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        
        <div className={cn(
          "px-5 py-3.5 rounded-2xl shadow-sm relative",
          isUser 
            ? "bg-zinc-900 text-white rounded-tr-sm" 
            : "bg-white border border-zinc-200 text-zinc-800 rounded-tl-sm"
        )}>
          {message.text && (
            <div className={cn("prose prose-sm max-w-none", isUser ? "prose-invert" : "")}>
              <Markdown>{message.text}</Markdown>
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 ml-1 bg-zinc-400 animate-pulse align-middle" />
              )}
            </div>
          )}
          
          {message.fileName && (
            <div className={cn(
              "flex items-center justify-between gap-4 px-3 py-2 rounded-lg w-fit",
              message.text ? "mt-3" : "",
              isUser ? "bg-white/10 text-zinc-300" : "bg-zinc-100 text-zinc-600"
            )}>
              <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4" />
                <span className="text-xs font-medium">{message.fileName}</span>
              </div>
              {message.fileContent && (
                <button
                  onClick={handleDownloadDocx}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 px-2 py-1 rounded transition-colors"
                  title="Download as DOCX"
                >
                  <Download className="w-3 h-3" />
                  Download
                </button>
              )}
              {isUser && message.fileContent && onSaveAsset && (
                <button
                  onClick={() => onSaveAsset(message)}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 px-2 py-1 rounded transition-colors"
                  title="Mark as Final Asset"
                >
                  <Save className="w-3 h-3" />
                  Save Asset
                </button>
              )}
            </div>
          )}

          {message.proposals && message.proposals.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between gap-2 pb-1 border-b border-zinc-200/60">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Executive Board Proposals</span>
                <div className="flex items-center gap-2">
                  {message.proposals.some(p => p.status === 'pending') && (
                    <button
                      onClick={() => {
                        message.proposals?.filter(p => p.status === 'pending').forEach(p => {
                          onApproveProposal?.(message.id, p);
                        });
                      }}
                      className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-md transition-colors"
                    >
                      Approve All
                    </button>
                  )}
                  {onPassResolution && (
                    <button
                      onClick={() => {
                        const title = message.proposals?.[0]?.title ? `Board Resolution: ${message.proposals[0].title}` : "Board Resolution on Executive Plan";
                        const content = `WHEREAS the Executive Board has reviewed and discussed the proposed action items:\n\n${message.proposals?.map(p => `- ${p.title} (${p.type.toUpperCase()})`).join('\n')}\n\nRESOLVED THAT the Board hereby approves and adopts these measures in full.`;
                        onPassResolution(title, content);
                      }}
                      className="text-[10px] font-bold text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-md transition-colors"
                    >
                      Pass Board Resolution
                    </button>
                  )}
                </div>
              </div>

              {message.proposals.map(proposal => (
                <div key={proposal.id} className="flex items-center justify-between gap-4 p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">
                      Proposed {proposal.type}
                    </span>
                    <span className="text-sm font-medium text-zinc-900">{proposal.title}</span>
                  </div>
                  
                  {proposal.status === 'pending' ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onApproveProposal?.(message.id, proposal)}
                        className="p-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg transition-colors"
                        title="Approve"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onRejectProposal?.(message.id, proposal)}
                        className="p-1.5 bg-rose-100 text-rose-700 hover:bg-rose-200 rounded-lg transition-colors"
                        title="Reject"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <span className={cn(
                      "text-xs font-bold px-2 py-1 rounded-md",
                      proposal.status === 'approved' ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                    )}>
                      {proposal.status === 'approved' ? 'Approved' : 'Rejected'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          
          <div className={cn(
            "absolute -bottom-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity",
            isUser ? "right-0" : "left-0"
          )}>
            <button onClick={() => onReply?.(message)} className="text-xs text-zinc-400 hover:text-indigo-600">Reply</button>
            {isUser && <button onClick={() => onEdit?.(message)} className="text-xs text-zinc-400 hover:text-indigo-600">Edit</button>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
