import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from "@google/genai";
import { apiFetch } from '../db';
import { Agent, CompanyContext } from '../types';

// Helper for Firestore error handling as per guidelines
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface UseGeminiLiveProps {
  company: CompanyContext;
  team: Agent[];
  onMessage?: (text: string, agentId: string) => void;
}

export function useGeminiLive({ company, team, onMessage }: UseGeminiLiveProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const [isThinking, setIsThinking] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [fullTranscript, setFullTranscript] = useState('');
  
  const isConnectedRef = useRef(false);
  const isMutedRef = useRef(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const stopAudio = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsRecording(false);
    setVolume(0);
    setIsThinking(false);
    setActiveAgentId(null);
  }, []);

  const teamRef = useRef(team);
  useEffect(() => {
    teamRef.current = team;
  }, [team]);

  const playNextChunk = useCallback(async () => {
    if (audioQueueRef.current.length === 0 || isPlayingRef.current || !audioContextRef.current) {
      return;
    }

    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;
    
    const audioBuffer = audioContextRef.current.createBuffer(1, chunk.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    
    for (let i = 0; i < chunk.length; i++) {
      channelData[i] = chunk[i] / 32768.0;
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    currentSourceRef.current = source;
    
    source.onended = () => {
      if (currentSourceRef.current === source) {
        currentSourceRef.current = null;
      }
      isPlayingRef.current = false;
      playNextChunk();
    };

    source.start();
  }, []);

  const startRecording = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      processorRef.current.onaudioprocess = (e) => {
        if (!sessionRef.current || !isConnectedRef.current || isMutedRef.current) {
          if (isMutedRef.current) setVolume(0);
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate volume for visualizer
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        setVolume(rms);

        // If user is speaking, they are likely triggering a "thinking" state from the AI
        if (rms > 0.05 && !isPlayingRef.current) {
          setIsThinking(true);
        }

        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
        }

        // More robust base64 conversion
        const uint8Array = new Uint8Array(pcmData.buffer);
        let binary = '';
        const len = uint8Array.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64Data = btoa(binary);

        sessionRef.current.sendRealtimeInput({
          media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };

      source.connect(processorRef.current);
      
      // Mute the monitor so user doesn't hear themselves
      const gainNode = audioContextRef.current.createGain();
      gainNode.gain.value = 0;
      processorRef.current.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);

      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError("Microphone access denied.");
    }
  };

  const transcriptionBufferRef = useRef('');

  const connect = useCallback(async () => {
    try {
      setError(null);
      transcriptionBufferRef.current = '';
      const apiKey =
        (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) ||
        (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
        'DEMO_KEY';
      const ai = new GoogleGenAI({ apiKey });
      
      const systemInstruction = `You are the virtual C-Suite board of ${company.name}. 
      The board members are:
      ${team.map(a => `- ${a.name} (${a.role}): ${a.bio}`).join('\n')}
      
      You are in a real-time voice discussion with the Founder. 
      You are NOT an AI assistant; you ARE the board members. 
      
      ROLE-BASED ADDRESSING:
      - If the Founder addresses a specific role (e.g., "CEO", "CFO", "Marketing Lead"), that specific board member MUST take the lead and respond first.
      - If the Founder addresses the "Board" or "Team" generally, the CEO should typically lead, but other members can chime in if the topic is relevant to their expertise.
      - You must recognize roles like "CEO", "CTO", "CFO", etc., and respond accordingly.
      
      SHARED RESOURCES (FILES & LINKS):
      - The Founder may share images, documents (as images or text), or links during the meeting.
      - When a resource is shared, acknowledge it and discuss its implications for the company.
      - Use your expertise to analyze the shared content.
      - If a link is shared, you can use your tools to understand its context if necessary.
      
      VOICE & HUMANITY:
      - NEVER use robotic meta-talk (e.g., "The CEO will now speak" or "I am switching to the CTO").
      - Speak DIRECTLY as the board members. 
      - Use natural, human-like speech patterns. 
      - DISTINCT VOCAL PERSONALITIES: Even though you are using one voice stream, you MUST use your acting capabilities to distinguish members:
        * CEO: Authoritative, steady, slightly deeper pitch.
        * CTO: Faster pace, technical enthusiasm, energetic.
        * CFO: Precise, measured, calm, analytical.
        * CMO: Creative, expressive, varied intonation.
      - Vary your tone, pace, and vocabulary based on the specific board member who is speaking. 
      - Use professional yet conversational language. 
      - Use natural fillers like "Well...", "I see...", "That's a great point...", or "Actually..." to sound more human.
      - If one board member hands off to another, do it naturally: "I think our CTO, ${team.find(a => a.role.toLowerCase().includes('tech') || a.role.toLowerCase().includes('cto'))?.name || 'the CTO'}, has some thoughts on the technical side of this."
      
      CRITICAL: When you start speaking as a specific board member, you MUST start your response with their name in brackets followed by a colon, exactly like this: "[Name]: ". This is the ONLY way the UI can highlight the correct speaker. Use the member's full name from the list above.
      
      CRITICAL INTERRUPTION HANDLING:
      1. You can be interrupted at any time. 
      2. If the Founder interrupts you, STOP speaking immediately.
      3. Acknowledge the interruption gracefully and address the new point.
      
      Keep responses concise, high-impact, and focused on strategic value.
      
      TOOLS:
      - Board members can check their assigned tasks using \`get_tasks\` and update their status using \`update_task_status\`.
      - The CEO (or any board member) can schedule new strategic tasks for others using \`create_task\`. This allows the Founder (the user) to delegate work through the AI.
      - The Marketing Lead (CMO) has access to the \`add_lead_to_hubspot\`, \`add_note_to_hubspot\`, \`create_task_in_hubspot\`, \`get_contacts_from_hubspot\`, \`get_contact_emails_from_hubspot\`, \`send_email\`, and \`make_outbound_call\` tools. If the Founder asks to add a lead, log a note, create a task, fetch contacts, list leads, read emails, send emails, or make a call, the CMO should use these tools. NEVER guess or hallucinate CRM data, ALWAYS use the get_contacts_from_hubspot tool to fetch real data.
      - CRITICAL: When sending emails, the CMO MUST use the \`send_email\` tool to send them via Zoho. Emails MUST be sent one by one, NEVER as a group. The tool will return a success or error message indicating if the email was sent via Zoho. The CMO should inform the user of the result. Emails should be sent via Zoho only, not via the CRM.
      - CRITICAL: When the CMO uses the \`make_outbound_call\` tool, it ONLY initiates the call dialing process. The CMO DOES NOT hear the live call and CANNOT speak on the live call from this interface. The CMO MUST NOT invent, hallucinate, or summarize a conversation that hasn't happened. After using the tool, simply tell the user "I have initiated the call to [number]. I will handle the conversation and you can ask me for a summary when it's done." Ensure the phone number is formatted in E.164 international format (e.g., +234... or +254...).
      - To check the outcome or summary of a call you made, use the \`get_recent_calls\` tool. This will give you the actual transcript summary of what happened on the call. Do not assume or guess what happened.
      - The CMO also has access to Google Search to find new leads, research companies, and gather contact information from the web.
      - You have access to the Google Search tool to research and extract leads. Use this immediately when the Founder asks to find leads or research a company/person. Do not attempt to use any other lead database tools.
      - When a task is assigned, the relevant board member should acknowledge it and use \`update_task_status\` to track progress.
      `;

      const addLeadToHubspot: FunctionDeclaration = {
        name: "add_lead_to_hubspot",
        description: "Add a new lead/contact to HubSpot CRM.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            email: { type: Type.STRING, description: "Email address of the lead" },
            firstname: { type: Type.STRING, description: "First name of the lead" },
            lastname: { type: Type.STRING, description: "Last name of the lead" },
            phone: { type: Type.STRING, description: "Phone number of the lead" }
          },
          required: ["email", "firstname"]
        }
      };

      const addNoteToHubspot: FunctionDeclaration = {
        name: "add_note_to_hubspot",
        description: "Add a note to an existing contact in HubSpot CRM.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            email: { type: Type.STRING, description: "Email address of the contact" },
            noteBody: { type: Type.STRING, description: "Content of the note" }
          },
          required: ["email", "noteBody"]
        }
      };

      const createTaskInHubspot: FunctionDeclaration = {
        name: "create_task_in_hubspot",
        description: "Create a sales task for an existing contact in HubSpot CRM.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            email: { type: Type.STRING, description: "Email address of the contact" },
            subject: { type: Type.STRING, description: "Subject of the task" },
            body: { type: Type.STRING, description: "Details of the task" }
          },
          required: ["email", "subject", "body"]
        }
      };

      const getContactsFromHubspot: FunctionDeclaration = {
        name: "get_contacts_from_hubspot",
        description: "Fetch a list of recent contacts and leads from HubSpot CRM, including their phone numbers and emails. Use this tool whenever asked to list leads, count leads, or retrieve CRM contacts.",
        parameters: {
          type: Type.OBJECT,
          properties: {}
        }
      };

      const getContactEmailsFromHubspot: FunctionDeclaration = {
        name: "get_contact_emails_from_hubspot",
        description: "Fetch emails previously sent to/from a specific contact in HubSpot CRM.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            email: { type: Type.STRING, description: "Email address of the contact to fetch emails for" }
          },
          required: ["email"]
        }
      };

      const sendEmail: FunctionDeclaration = {
        name: "send_email",
        description: "Send a real, beautifully designed HTML email to a contact using Zoho SMTP. Emails MUST be sent one by one. The tool returns success if sent via Zoho, or an error message if it failed.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            email: { type: Type.STRING, description: "Email address of the contact to send the email to" },
            subject: { type: Type.STRING, description: "Subject of the email" },
            body: { type: Type.STRING, description: "Body/content of the email. Use paragraphs and newlines." }
          },
          required: ["email", "subject", "body"]
        }
      };

      const makeOutboundCall: FunctionDeclaration = {
        name: "make_outbound_call",
        description: "Initiate an outbound phone call to a lead using the Africa's Talking dialer. The phone number MUST be in E.164 international format (e.g., +234... or +254...). If the user provides the phone number and company details in the chat, you can use those directly. Otherwise, you MUST fetch the contact from HubSpot first using get_contacts_from_hubspot.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            phone: { type: Type.STRING, description: "The phone number to call in E.164 format (e.g., +2347067434684)" },
            objective: { type: Type.STRING, description: "The goal or prompt for the AI during the call (e.g., 'Pitch our new product')" }
          },
          required: ["phone", "objective"]
        }
      };

      const getTasks: FunctionDeclaration = {
        name: "get_tasks",
        description: "Fetch the list of tasks assigned to you or the company.",
        parameters: {
          type: Type.OBJECT,
          properties: {}
        }
      };

      const getRecentCalls: FunctionDeclaration = {
        name: "get_recent_calls",
        description: "Fetch the summaries of recent outbound calls made by the CMO.",
        parameters: {
          type: Type.OBJECT,
          properties: {}
        }
      };

      const updateTaskStatus: FunctionDeclaration = {
        name: "update_task_status",
        description: "Update the status of a specific task.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: "The ID of the task to update" },
            status: { type: Type.STRING, enum: ["pending", "in-progress", "completed", "failed"], description: "The new status of the task" }
          },
          required: ["taskId", "status"]
        }
      };

      const createTask: FunctionDeclaration = {
        name: "create_task",
        description: "Create a new strategic task for a board member.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "The title of the task" },
            description: { type: Type.STRING, description: "Detailed description of the task" },
            assignedTo: { type: Type.STRING, description: "The ID of the agent to assign the task to" },
            status: { type: Type.STRING, enum: ["pending", "in-progress", "completed", "failed"], description: "Initial status" }
          },
          required: ["title", "assignedTo", "status"]
        }
      };

      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [
            { functionDeclarations: [addLeadToHubspot, addNoteToHubspot, createTaskInHubspot, getContactsFromHubspot, getContactEmailsFromHubspot, sendEmail, makeOutboundCall, getTasks, updateTaskStatus, createTask, getRecentCalls] },
            { googleSearch: {} }
          ],
          toolConfig: { includeServerSideToolInvocations: true },
          speechConfig: {
            voiceConfig: { 
              prebuiltVoiceConfig: { 
                // "Aoede" is often considered very human-like, but let's stick to the ones in the prompt if they are the only ones.
                // Actually, "Zephyr" is fine, but let's ensure the prompt drives the "human" feel.
                voiceName: "Zephyr" 
              } 
            },
          },
          systemInstruction,
          outputAudioTranscription: {},
        } as any,
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            isConnectedRef.current = true;
            startRecording();
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              const call = message.toolCall.functionCalls[0];
              if (call.name === 'add_lead_to_hubspot') {
                const args = call.args as any;
                try {
                  const res = await fetch('/api/hubspot/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      apiKey: company.integrations?.hubspotApiKey,
                      email: args.email,
                      firstname: args.firstname,
                      lastname: args.lastname,
                      phone: args.phone
                    })
                  });
                  const data = await res.json();
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: res.ok ? { success: true, contact: data } : { error: data.error }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to connect to HubSpot" }
                    }]
                  });
                }
              } else if (call.name === 'add_note_to_hubspot') {
                const args = call.args as any;
                try {
                  const res = await fetch('/api/hubspot/note', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      apiKey: company.integrations?.hubspotApiKey,
                      email: args.email,
                      noteBody: args.noteBody
                    })
                  });
                  const data = await res.json();
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: res.ok ? { success: true, note: data } : { error: data.error }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to connect to HubSpot" }
                    }]
                  });
                }
              } else if (call.name === 'create_task_in_hubspot') {
                const args = call.args as any;
                try {
                  const res = await fetch('/api/hubspot/task', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      apiKey: company.integrations?.hubspotApiKey,
                      email: args.email,
                      subject: args.subject,
                      body: args.body
                    })
                  });
                  const data = await res.json();
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: res.ok ? { success: true, task: data } : { error: data.error }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to connect to HubSpot" }
                    }]
                  });
                }
              } else if (call.name === 'get_contacts_from_hubspot') {
                try {
                  const res = await fetch('/api/hubspot/contacts/list', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey: company.integrations?.hubspotApiKey })
                  });
                  const data = await res.json();
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: res.ok ? { success: true, contacts: data.contacts } : { error: data.error }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to fetch contacts from HubSpot" }
                    }]
                  });
                }
              } else if (call.name === 'get_contact_emails_from_hubspot') {
                const args = call.args as any;
                try {
                  const res = await fetch('/api/hubspot/emails', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey: company.integrations?.hubspotApiKey, email: args.email })
                  });
                  const data = await res.json();
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: res.ok ? { success: true, emails: data.emails } : { error: data.error }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to fetch emails from HubSpot" }
                    }]
                  });
                }
              } else if (call.name === 'send_email') {
                const args = call.args as any;
                try {
                  const res = await fetch('/api/email/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      zohoEmail: company.integrations?.zohoEmail,
                      zohoPassword: company.integrations?.zohoPassword,
                      hubspotApiKey: company.integrations?.hubspotApiKey, 
                      email: args.email,
                      subject: args.subject,
                      body: args.body,
                      companyName: company.name
                    })
                  });
                  const data = await res.json();
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: res.ok ? { success: true, message: data.message } : { error: data.error }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to send email via Zoho" }
                    }]
                  });
                }
              } else if (call.name === 'make_outbound_call') {
                const args = call.args as any;
                const apiKey = company.integrations?.africasTalkingApiKey;
                const username = company.integrations?.africasTalkingUsername;
                const virtualNumber = company.integrations?.africasTalkingVirtualNumber;
                
                try {
                  const res = await fetch('/api/dialer/call', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      apiKey,
                      username,
                      virtualNumber,
                      phone: args.phone,
                      objective: args.objective,
                      company
                    })
                  });
                  const data = await res.json();
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: res.ok ? { 
                        success: true, 
                        message: `Call initiated successfully to ${args.phone}. CRITICAL INSTRUCTION: Tell the user exactly this: "I have initiated the call to ${args.phone}. I will handle the conversation and you can ask me for a summary when it's done." DO NOT ADD ANY OTHER TEXT. DO NOT HALLUCINATE A CONVERSATION.` 
                      } : { error: data.error }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: `Failed to initiate call via Africa's Talking` }
                    }]
                  });
                }
              } else if (call.name === 'get_tasks') {
                try {
                  const res = await apiFetch<{ tasks: any[] }>(`/api/companies/${company.id}/tasks`);
                  const tasks = (res.tasks || []).filter(t => t.assignedTo === activeAgentId);
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { success: true, tasks }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to fetch tasks" }
                    }]
                  });
                }
              } else if (call.name === 'get_recent_calls') {
                try {
                  const res = await fetch(`/api/dialer/calls?companyId=${company.id}`);
                  const calls = await res.json();
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { calls }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to fetch recent calls" }
                    }]
                  });
                }
              } else if (call.name === 'update_task_status') {
                const args = call.args as any;
                try {
                  await apiFetch(`/api/tasks/${args.taskId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: args.status })
                  });
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { success: true }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to update task" }
                    }]
                  });
                }
              } else if (call.name === 'create_task') {
                const args = call.args as any;
                try {
                  const taskId = Math.random().toString(36).substring(7);
                  const newTask = {
                    id: taskId,
                    companyId: company.id,
                    assignedTo: args.assignedTo,
                    title: args.title,
                    description: args.description || "",
                    status: args.status,
                    createdAt: Date.now()
                  };
                  
                  await apiFetch(`/api/companies/${company.id}/tasks`, {
                    method: 'POST',
                    body: JSON.stringify(newTask)
                  });
                  
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { success: true, taskId }
                    }]
                  });
                } catch (err) {
                  session.sendToolResponse({
                    functionResponses: [{
                      name: call.name,
                      id: call.id,
                      response: { error: "Failed to create task" }
                    }]
                  });
                }
              }
            }

            // Handle transcription to identify active agent
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.text) {
                  // Accumulate text to handle split chunks
                  transcriptionBufferRef.current += part.text;
                  setFullTranscript(prev => prev + part.text);
                  
                  // Robust regex to find speaker identifiers in the accumulated buffer
                  // Matches: [Name]:, Name:, [Role]:, Role:
                  const speakerMatch = transcriptionBufferRef.current.match(/(?:\[)?(.*?)(?:\])?\s*:/);
                  if (speakerMatch) {
                    const identifier = speakerMatch[1].trim().toLowerCase();
                    const agent = teamRef.current.find(a => 
                      a.name.toLowerCase().includes(identifier) || 
                      identifier.includes(a.name.toLowerCase()) ||
                      a.role.toLowerCase().includes(identifier) ||
                      identifier.includes(a.role.toLowerCase())
                    );
                    if (agent) {
                      setActiveAgentId(agent.id);
                      // Once we've identified the speaker, we can clear the buffer 
                      // to prevent re-matching or matching wrong things later in the turn
                      transcriptionBufferRef.current = ''; 
                    }
                  }
                }
                
                if (part.inlineData?.data) {
                  setIsThinking(false); // Stop thinking when audio starts arriving
                  const binaryString = atob(part.inlineData.data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  const pcmData = new Int16Array(bytes.buffer);
                  audioQueueRef.current.push(pcmData);
                  playNextChunk();
                }
              }
            }
            
            if (message.serverContent?.turnComplete) {
              transcriptionBufferRef.current = '';
            }
            
            if (message.serverContent?.interrupted) {
              if (currentSourceRef.current) {
                currentSourceRef.current.stop();
                currentSourceRef.current = null;
              }
              audioQueueRef.current = [];
              isPlayingRef.current = false;
              setIsThinking(false);
              setActiveAgentId(null);
              transcriptionBufferRef.current = '';
            }
          },
          onclose: () => {
            setIsConnected(false);
            isConnectedRef.current = false;
            stopAudio();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error. Please try again.");
            setIsConnected(false);
            isConnectedRef.current = false;
            stopAudio();
          }
        }
      });

      sessionRef.current = session;
    } catch (err: any) {
      const message = err?.message || err?.error?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      const status = err?.status || err?.error?.status;
      
      if (message.includes('exceeded your current quota') || message.includes('check your plan and billing details') || message.includes('RESOURCE_EXHAUSTED') || status === 'RESOURCE_EXHAUSTED') {
        console.warn("Live API hit quota limit.");
        setError("AI API quota exceeded. Please check your Gemini API plan and billing details.");
      } else if (status === 'Internal Server Error' || message.includes('500') || message.includes('Internal Server Error')) {
        console.warn("Live API encountered a server error (500).");
        setError("Live API encountered a temporary server error. Please try again later.");
      } else {
        console.error("Failed to connect to Live API:", err);
        setError("Failed to start voice mode.");
      }
    }
  }, [company, team, stopAudio, playNextChunk]);

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    stopAudio();
    setIsConnected(false);
    isConnectedRef.current = false;
  }, [stopAudio]);

  const sendImage = useCallback((base64Data: string, mimeType: string) => {
    if (sessionRef.current && isConnectedRef.current) {
      sessionRef.current.sendRealtimeInput({
        media: { data: base64Data, mimeType }
      });
    }
  }, []);

  const sendText = useCallback((text: string) => {
    if (sessionRef.current && isConnectedRef.current) {
      // For Live API, we send text using sendClientContent
      sessionRef.current.sendClientContent({
        turns: text,
        turnComplete: true
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isRecording,
    error,
    volume,
    isThinking,
    activeAgentId,
    isMuted,
    setIsMuted,
    fullTranscript,
    connect,
    disconnect,
    sendImage,
    sendText
  };
}
