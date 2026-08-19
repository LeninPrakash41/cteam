import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { apiFetch } from "../db";
import { Agent, CompanyContext, Message, Task, Goal, Proposal, MarketingAsset } from "../types";

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

function getGeminiApiKey(): string {
  const key =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) ||
    (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY);
  return key || 'DEMO_KEY';
}

function getAiClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: getGeminiApiKey() });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 5, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // The error object structure is { error: { status: 'RESOURCE_EXHAUSTED', ... } }
    const status = error?.status || error?.error?.status;
    const message = error?.message || error?.error?.message || (typeof error === 'string' ? error : JSON.stringify(error));
    const isRateLimited = status === 'RESOURCE_EXHAUSTED' || message?.includes('429') || message?.includes('RESOURCE_EXHAUSTED');
    const isHardQuota = message?.includes('exceeded your current quota') || message?.includes('check your plan and billing details');
    const isServerError = status === 'Internal Server Error' || message?.includes('500') || message?.includes('503') || message?.includes('Internal Server Error');
    
    if (retries > 0 && ((isRateLimited && !isHardQuota) || isServerError)) {
      console.warn(`API error (rate limit or server error), retrying in ${delay}ms... (Retries left: ${retries})`);
      // Add jitter to avoid thundering herd
      const jitter = Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
}

export async function generateTeam(industry: string, category: string, companyName: string): Promise<Agent[]> {
  const prompt = `You are an expert business consultant. A startup named "${companyName}" in the "${industry}" industry and "${category}" category needs a C-Suite executive team.
  Generate a team of 4 to 6 highly specialized C-Suite members (e.g., CEO, COO, CMO, CTO, Head of Sales, etc.) tailored to this specific business.
  Each member should have 28 years of experience and deep expertise.
  Return a JSON array of objects, where each object has:
  - id: a unique lowercase string (e.g., "ceo", "cmo")
  - role: their job title (e.g., "Chief Executive Officer")
  - name: a realistic full name
  - bio: a brief, professional biography highlighting their 28 years of experience and specific achievements relevant to the industry.
  - expertise: an array of 3-5 specific areas of expertise (strings).
  - avatarUrl: a realistic avatar URL using picsum (e.g., "https://picsum.photos/seed/ceo-${companyName.replace(/\\s+/g, '')}/200")
  `;

  const response = await withRetry(async () => await getAiClient().models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            role: { type: Type.STRING },
            name: { type: Type.STRING },
            bio: { type: Type.STRING },
            expertise: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            avatarUrl: { type: Type.STRING }
          },
          required: ["id", "role", "name", "bio", "expertise", "avatarUrl"]
        }
      }
    }
  }));

  try {
    let text = (response.text || "[]").trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\\n?/, '').replace(/\\n?```$/, '').trim();
    }
    return JSON.parse(text) as Agent[];
  } catch (e) {
    console.error("Failed to parse team generation response", e);
    return [];
  }
}

export async function generateGoals(objective: string, company: CompanyContext): Promise<{ smartGoals: string[], kpis: string[] }> {
  const prompt = `You are an expert business strategist. The company "${company.name}" in the "${company.industry}" industry has the following high-level objective:
  
  Objective: "${objective}"
  
  Generate 3 to 5 SMART goals (Specific, Measurable, Achievable, Relevant, Time-bound) and 3 to 5 Key Performance Indicators (KPIs) to track progress toward this objective.
  
  Return a JSON object with:
  - smartGoals: an array of strings (the SMART goals)
  - kpis: an array of strings (the KPIs)
  `;

  const response = await withRetry(async () => await getAiClient().models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          smartGoals: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          kpis: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["smartGoals", "kpis"]
      }
    }
  }));

  try {
    let text = (response.text || "{}").trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    return JSON.parse(text) as { smartGoals: string[], kpis: string[] };
  } catch (e) {
    console.error("Failed to parse goals generation response", e);
    return { smartGoals: [], kpis: [] };
  }
}

export interface AgentResponse {
  agentId: string;
  message: string;
}

export async function chatWithBoardStream(
  company: CompanyContext,
  team: Agent[],
  history: Message[],
  userMessage: Message,
  tasks: Task[],
  goals: Goal[],
  assets: MarketingAsset[],
  onAgentStart: (agentId: string) => void,
  onStreamChunk: (agentId: string, chunk: string) => void,
  onAgentComplete: (agentId: string, fullText: string, proposals?: Proposal[], fileName?: string, fileContent?: string) => void
): Promise<void> {
  const systemInstruction = `You are the CEO and Orchestrator of a virtual C-Suite boardroom for a startup.
  Company Context:
  Name: ${company.name}
  Industry: ${company.industry}
  Category: ${company.category}
  Description: ${company.description}

  The Team:
  ${team.map(a => `- ${a.id} (${a.role}): ${a.bio}. Expertise: ${a.expertise.join(", ")}`).join("\\n")}

  The user is the Founder/Chairperson addressing the board.
  
  ROLE-BASED ADDRESSING:
  - CRITICAL: If the Founder explicitly tags a specific board member using "@" (e.g., "@cmo", "@cto", "@ceo"), ONLY that specific board member MUST be included in the response list. No one else should respond unless also tagged.
  - If the Founder addresses a specific role by name (e.g., "CEO", "CTO"), that specific board member MUST be included in the response list.
  - If the Founder addresses the "Board" or "Team" generally, select the most relevant 1 to 2 members.
  
  DOCUMENT ANALYSIS:
  - You have access to the content of documents (PDFs, DOCX, text files) uploaded by the Founder in the chat history.
  - When asked about a document, analyze its content thoroughly and provide insights, summaries, or answers based on the document's information.

  Your task:
  1. Determine which board members should respond to the user's message based on their specific roles, expertise, and explicit @tags.
  2. Return a JSON array of their agent IDs in the order they should speak.
  `;

  const chatHistoryText = history.slice(-10).map(msg => {
    const sender = msg.senderId === 'user' ? 'Founder' : team.find(a => a.id === msg.senderId)?.name || msg.senderId;
    let text = msg.text;
    if (msg.fileContent) {
      text += `\n\n[Attached File: ${msg.fileName}]\n\`\`\`\n${msg.fileContent.substring(0, 10000)}\n\`\`\``;
    }
    return `${sender}: ${text}`;
  }).join("\n\n");

  let currentUserMessageText = userMessage.text;
  if (userMessage.fileContent) {
    currentUserMessageText += `\n\n[Attached File: ${userMessage.fileName}]\n\`\`\`\n${userMessage.fileContent.substring(0, 10000)}\n\`\`\``;
  }

  const prompt = `Chat History:\n${chatHistoryText}\n\nFounder: ${currentUserMessageText}\n\nWhich agents should respond? Return a JSON array of strings (agent IDs).`;

  const hasUrl = /https?:\/\/[^\s]+/.test(prompt);
  const toolsConfig = hasUrl ? [{ urlContext: {} }] : undefined;

  let selectedAgents: string[] = [];
  try {
    const response = await getAiClient().models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        },
        ...(toolsConfig && { tools: toolsConfig })
      }
    });

    let text = (response.text || "[]").trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\\n?/, '').replace(/\\n?```$/, '').trim();
    }
    selectedAgents = JSON.parse(text) as string[];
  } catch (e) {
    console.error("Failed to parse orchestrator response", e);
    // Fallback to CEO or first agent
    selectedAgents = [team[0]?.id].filter(Boolean);
  }

  // Ensure valid agents and remove duplicates
  selectedAgents = Array.from(new Set(selectedAgents.filter(id => team.some(a => a.id === id)))).slice(0, 2);
  if (selectedAgents.length === 0 && team.length > 0) {
    selectedAgents = [team[0].id];
  }

  // Now, stream responses for each selected agent sequentially
  let currentHistory = `${chatHistoryText}\n\nFounder: ${currentUserMessageText}`;

  for (const agentId of selectedAgents) {
    const agent = team.find(a => a.id === agentId)!;
    onAgentStart(agentId);

    let agentPrompt = `You are ${agent.name}, the ${agent.role} of ${company.name}.
    Company Context: ${company.description}
    Your Bio: ${agent.bio}
    Your Expertise: ${agent.expertise.join(", ")}

    CURRENT COMPANY STATE:
    Active Tasks:
    ${tasks.filter(t => t.status !== 'completed').map(t => `- ${t.title}`).join("\n") || "None"}
    
    Active Goals:
    ${goals.map(g => `- ${g.objective}`).join("\n") || "None"}

    Approved Marketing Assets:
    ${assets.map(a => `- ${a.name} (ID: ${a.id})`).join("\n") || "None"}

    The Founder has addressed the board. Respond from your specific perspective and expertise.
    
    VOICE & PERSONALITY:
    - DO NOT sound like a robotic AI assistant.
    - Use natural, human-like speech patterns.
    - Use professional yet conversational language.
    - Be decisive and strategic.
    
    INSTRUCTIONS:
    - Keep your response concise, actionable, and professional. Use markdown.
    - Do not introduce yourself (e.g., "Hi, I'm the CEO"), just give your advice directly as the character.
    - You have access to the content of documents (PDFs, DOCX, text files) uploaded by the Founder in the chat history. Analyze them thoroughly when asked.
    - When asked to draft a proposal, report, or document, provide a highly detailed, well-structured, and comprehensive professional document. Be clear and avoid unnecessary complication.
    - You can check your assigned tasks using \`get_tasks\` and update their status using \`update_task_status\`.
    - You can schedule new strategic tasks for others using \`create_task\`. This allows the Founder (the user) to delegate work through the AI.
    - When a task is assigned, acknowledge it and use \`update_task_status\` to track progress.
    - DO NOT output text like "[Tool Call: name]". If you need to use a tool, use the native function calling mechanism.
    `;

    if (agent.role.toLowerCase().includes('ceo') || agent.id === 'ceo') {
      agentPrompt += `\n\nPROPOSING ACTION ITEMS:
      As the CEO, you should propose official Tasks and Goals for the Founder to approve when wrapping up a strategy or deciding on next steps.
      To propose a task, use this exact format on a new line: [TASK: Task Title]
      To propose a goal, use this exact format on a new line: [GOAL: Goal Title]
      Only propose them if it naturally fits the conversation.`;
    }

    let agentToolsConfig: any[] = toolsConfig ? [...toolsConfig] : [];
    
    if (agent.role.toLowerCase().includes('cmo') || agent.role.toLowerCase().includes('marketing')) {
      agentPrompt += `\n\nMARKETING & OUTREACH TOOLS:
      As the CMO, you have access to HubSpot CRM, Zoho email, and a live telephony dialer.
      - If the Founder asks to add a lead, log a note, create a task, list leads, or fetch contacts, use the HubSpot tools. NEVER guess or hallucinate CRM data, ALWAYS use the get_contacts_from_hubspot tool to fetch real data.
      - CRITICAL: When sending emails, you MUST use the \`send_email\` tool to send them via Zoho. Emails MUST be sent one by one, NEVER as a group. The tool will return a success or error message indicating if the email was sent via Zoho. You should inform the user of the result. Emails should be sent via Zoho only, not via the CRM.
      - If the Founder asks you to call someone, dial a number, or make an outbound call, YOU MUST USE the \`make_outbound_call\` tool. Do not say you cannot make calls or that it was a simulation. You have a live dialer integration. Use the tool. Ensure the phone number is formatted in E.164 international format (e.g., +234... or +254...).
      - CRITICAL: When you use the \`make_outbound_call\` tool, it ONLY initiates the call dialing process. You DO NOT hear the live call and you CANNOT speak on the live call from this text interface. You MUST NOT invent, hallucinate, or summarize a conversation that hasn't happened. After using the tool, simply tell the user "I have initiated the call to [number]. I will handle the conversation and you can ask me for a summary when it's done."
      - To check the outcome or summary of a call you made, use the \`get_recent_calls\` tool. This will give you the actual transcript summary of what happened on the call. Do not assume or guess what happened.
      - You have access to the Google Search tool to research and extract leads. Use this immediately when the Founder asks to find leads or research a company/person. Do not attempt to use any other lead database tools.`;
      
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

      const createDocument: FunctionDeclaration = {
        name: "create_document",
        description: "Create a new document (e.g., report, proposal, marketing copy) and save it as an asset.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "The title or filename of the document" },
            content: { type: Type.STRING, description: "The full text content of the document (use markdown if appropriate)" }
          },
          required: ["title", "content"]
        }
      };

      const editDocument: FunctionDeclaration = {
        name: "edit_document",
        description: "Edit an existing document/asset by providing its ID and the new full content.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            documentId: { type: Type.STRING, description: "The ID of the document/asset to edit" },
            newContent: { type: Type.STRING, description: "The new full text content of the document" }
          },
          required: ["documentId", "newContent"]
        }
      };
      
      // The @google/genai SDK v1.29.0 drops includeServerSideToolInvocations, 
      // so we cannot mix built-in tools with function declarations.
      // UPDATE: We upgraded to v1.48.0 which supports includeServerSideToolInvocations.
      agentToolsConfig = [
        { functionDeclarations: [addLeadToHubspot, addNoteToHubspot, createTaskInHubspot, getContactsFromHubspot, getContactEmailsFromHubspot, sendEmail, makeOutboundCall, getTasks, updateTaskStatus, createTask, createDocument, editDocument, getRecentCalls] },
        { googleSearch: {} }
      ];
    }

    agentPrompt += `\n\nCurrent Conversation:\n${currentHistory}\n\nYour Response:`;

    try {
      let stream = await withRetry(async () => await getAiClient().models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        contents: agentPrompt,
        config: {
          ...(agentToolsConfig.length > 0 && { tools: agentToolsConfig }),
          ...(agentToolsConfig.length > 0 && { toolConfig: { includeServerSideToolInvocations: true } })
        }
      }));

      let fullResponse = "";
      let functionCallsToExecute: any[] = [];
      let createdFileName: string | undefined;
      let createdFileContent: string | undefined;

      for await (const chunk of stream) {
        if (chunk.functionCalls && chunk.functionCalls.length > 0) {
          functionCallsToExecute.push(...chunk.functionCalls);
        }
        if (chunk.text) {
          fullResponse += chunk.text;
          onStreamChunk(agentId, chunk.text);
        }
      }
      
      if (functionCallsToExecute.length > 0) {
        let toolResultsText = "\n\n[SYSTEM: The following tools were executed automatically. Use their results to formulate your final response to the Founder.]\n";
        let hasToolResults = false;

        for (const call of functionCallsToExecute) {
          if (call.name === 'add_lead_to_hubspot') {
            const args = call.args as any;
            
            // Notify UI that a tool is being used
            const phoneStr = args.phone ? ` - ${args.phone}` : '';
            onStreamChunk(agentId, `\n\n*(Adding lead to HubSpot: ${args.firstname} ${args.lastname || ''} - ${args.email}${phoneStr})*`);
            fullResponse += `\n\n*(Adding lead to HubSpot: ${args.firstname} ${args.lastname || ''} - ${args.email}${phoneStr})*`;
            
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
              
              if (!res.ok) {
                const errorData = await res.json();
                toolResultsText += `Tool 'add_lead_to_hubspot' error: ${errorData.error || 'Unknown error'}\n`;
              } else {
                toolResultsText += `Tool 'add_lead_to_hubspot' success: Lead added to HubSpot.\n`;
              }
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'add_lead_to_hubspot' error: Connection failed\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'add_note_to_hubspot') {
            const args = call.args as any;
            
            onStreamChunk(agentId, `\n\n*(Adding note to HubSpot contact: ${args.email})*`);
            fullResponse += `\n\n*(Adding note to HubSpot contact: ${args.email})*`;
            
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
              
              if (!res.ok) {
                const errorData = await res.json();
                toolResultsText += `Tool 'add_note_to_hubspot' error: ${errorData.error || 'Unknown error'}\n`;
              } else {
                toolResultsText += `Tool 'add_note_to_hubspot' success: Note added to HubSpot.\n`;
              }
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'add_note_to_hubspot' error: Connection failed\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'create_task_in_hubspot') {
            const args = call.args as any;
            
            onStreamChunk(agentId, `\n\n*(Creating task in HubSpot for: ${args.email})*`);
            fullResponse += `\n\n*(Creating task in HubSpot for: ${args.email})*`;
            
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
              
              if (!res.ok) {
                const errorData = await res.json();
                toolResultsText += `Tool 'create_task_in_hubspot' error: ${errorData.error || 'Unknown error'}\n`;
              } else {
                toolResultsText += `Tool 'create_task_in_hubspot' success: Task created in HubSpot.\n`;
              }
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'create_task_in_hubspot' error: Connection failed\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'get_contacts_from_hubspot') {
            onStreamChunk(agentId, `\n\n*(Fetching contacts from HubSpot...)*\n`);
            fullResponse += `\n\n*(Fetching contacts from HubSpot...)*\n`;
            
            try {
              const res = await fetch('/api/hubspot/contacts/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: company.integrations?.hubspotApiKey })
              });
              
              const data = await res.json();
              if (!res.ok) {
                toolResultsText += `Tool 'get_contacts_from_hubspot' error: ${data.error || 'Unknown error'}\n`;
              } else {
                toolResultsText += `Tool 'get_contacts_from_hubspot' success: Found ${data.contacts.length} contacts. Data: ${JSON.stringify(data.contacts)}\n`;
              }
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'get_contacts_from_hubspot' error: Connection failed\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'get_contact_emails_from_hubspot') {
            const args = call.args as any;
            onStreamChunk(agentId, `\n\n*(Fetching emails for ${args.email} from HubSpot...)*\n`);
            fullResponse += `\n\n*(Fetching emails for ${args.email} from HubSpot...)*\n`;
            
            try {
              const res = await fetch('/api/hubspot/emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: company.integrations?.hubspotApiKey, email: args.email })
              });
              
              const data = await res.json();
              if (!res.ok) {
                toolResultsText += `Tool 'get_contact_emails_from_hubspot' error: ${data.error || 'Unknown error'}\n`;
              } else {
                toolResultsText += `Tool 'get_contact_emails_from_hubspot' success: Found ${data.emails.length} emails. Data: ${JSON.stringify(data.emails)}\n`;
              }
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'get_contact_emails_from_hubspot' error: Connection failed\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'send_email') {
            const args = call.args as any;
            onStreamChunk(agentId, `\n\n*(Sending real email to ${args.email} via Zoho...)*\n`);
            fullResponse += `\n\n*(Sending real email to ${args.email} via Zoho...)*\n`;
            
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
              if (!res.ok) {
                toolResultsText += `Tool 'send_email' error: ${data.error || 'Unknown error'}\n`;
              } else {
                toolResultsText += `Tool 'send_email' success: Email actually sent to ${args.email}${data.hubspotLogged ? ' and logged in HubSpot' : ''}.\n`;
              }
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'send_email' error: Connection failed\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'make_outbound_call') {
            const args = call.args as any;
            const apiKey = company.integrations?.africasTalkingApiKey;
            const username = company.integrations?.africasTalkingUsername;
            const virtualNumber = company.integrations?.africasTalkingVirtualNumber;
            
            onStreamChunk(agentId, `\n\n*(Initiating outbound call to ${args.phone} via Africa's Talking...)*`);
            fullResponse += `\n\n*(Initiating outbound call to ${args.phone} via Africa's Talking...)*`;
            
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
              if (!res.ok) {
                toolResultsText += `Tool 'make_outbound_call' error: ${data.error || 'Unknown error'}\n`;
              } else {
                toolResultsText += `Tool 'make_outbound_call' success: Call initiated successfully. CRITICAL INSTRUCTION: Tell the user exactly this: "I have initiated the call to ${args.phone}. I will handle the conversation and you can ask me for a summary when it's done." DO NOT ADD ANY OTHER TEXT. DO NOT HALLUCINATE A CONVERSATION.\n`;
              }
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'make_outbound_call' error: Connection failed\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'get_tasks') {
            onStreamChunk(agentId, `\n\n*(Checking tasks...)*`);
            fullResponse += `\n\n*(Checking tasks...)*`;
            
            try {
              const res = await apiFetch<{ tasks: Task[] }>(`/api/companies/${company.id}/tasks`);
              const tasksList = (res.tasks || []).filter(t => t.assignedTo === agentId);
              
              toolResultsText += `Tool 'get_tasks' success: Found ${tasksList.length} tasks. Data: ${JSON.stringify(tasksList)}\n`;
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'get_tasks' error: Failed to fetch tasks\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'get_recent_calls') {
            onStreamChunk(agentId, `\n\n*(Fetching recent call summaries...)*`);
            fullResponse += `\n\n*(Fetching recent call summaries...)*`;
            
            try {
              const res = await fetch(`/api/dialer/calls?companyId=${company.id}`);
              const calls = await res.json();
              toolResultsText += `Tool 'get_recent_calls' success: ${JSON.stringify(calls)}\n`;
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'get_recent_calls' error: Failed to fetch calls\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'update_task_status') {
            const args = call.args as any;
            onStreamChunk(agentId, `\n\n*(Updating task status...)*`);
            fullResponse += `\n\n*(Updating task status...)*`;
            
            try {
              await apiFetch(`/api/tasks/${args.taskId}`, {
                method: 'PATCH',
                body: JSON.stringify({ status: args.status })
              });
              
              toolResultsText += `Tool 'update_task_status' success: Status updated to ${args.status}\n`;
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'update_task_status' error: Failed to update task\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'create_task') {
            const args = call.args as any;
            onStreamChunk(agentId, `\n\n*(Scheduling new task...)*`);
            fullResponse += `\n\n*(Scheduling new task...)*`;
            
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
              toolResultsText += `Tool 'create_task' success: Task created with ID ${taskId}\n`;
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'create_task' error: Failed to create task\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'create_document') {
            const args = call.args as any;
            onStreamChunk(agentId, `\n\n*(Creating document...)*`);
            fullResponse += `\n\n*(Creating document...)*`;
            
            try {
              const assetId = Math.random().toString(36).substring(7);
              const newAsset = {
                id: assetId,
                companyId: company.id,
                name: args.title,
                content: args.content,
                createdAt: Date.now()
              };
              
              await apiFetch(`/api/companies/${company.id}/assets`, {
                method: 'POST',
                body: JSON.stringify(newAsset)
              });
              createdFileName = args.title;
              createdFileContent = args.content;
              toolResultsText += `Tool 'create_document' success: Document created with ID ${assetId}\n`;
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'create_document' error: Failed to create document\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'edit_document') {
            const args = call.args as any;
            onStreamChunk(agentId, `\n\n*(Editing document...)*`);
            fullResponse += `\n\n*(Editing document...)*`;
            
            try {
              await apiFetch(`/api/companies/${company.id}/assets`, {
                method: 'POST',
                body: JSON.stringify({ id: args.documentId, companyId: company.id, content: args.newContent })
              });
              createdFileContent = args.newContent;
              toolResultsText += `Tool 'edit_document' success: Document updated\n`;
              hasToolResults = true;
            } catch (err) {
              toolResultsText += `Tool 'edit_document' error: Failed to edit document\n`;
              hasToolResults = true;
            }
          } else if (call.name === 'googleSearch') {
            const args = call.args as any;
            onStreamChunk(agentId, `\n\n*(Searching the web...)*`);
            fullResponse += `\n\n*(Searching the web...)*`;
            
            // The googleSearch tool is handled server-side by the Gemini API if includeServerSideToolInvocations is true.
            // However, if the model returns a function call for it, we can just say it was executed or we need to handle it.
            // Actually, with includeServerSideToolInvocations: true, the model should execute it and return the result in the stream.
            // If it returns it as a function call, we might need to handle it, but we can't easily execute googleSearch manually here.
            // Let's just note it.
            toolResultsText += `Tool 'googleSearch' was called but should be handled server-side by the Gemini API.\n`;
            hasToolResults = true;
          }
        }

        if (hasToolResults) {
          let stream2 = await withRetry(async () => await getAiClient().models.generateContentStream({
            model: "gemini-3.1-pro-preview",
            contents: agentPrompt + "\n\n" + fullResponse + toolResultsText + "\n\nNow, provide your final response to the Founder using the tool results above.",
            config: {}
          }));

          for await (const chunk of stream2) {
            if (chunk.text) {
              fullResponse += chunk.text;
              onStreamChunk(agentId, chunk.text);
            }
          }
        }
      }
      
      const proposals: Proposal[] = [];
      const taskRegex = /\[TASK:\s*(.+?)\]/g;
      const goalRegex = /\[GOAL:\s*(.+?)\]/g;
      
      let match;
      while ((match = taskRegex.exec(fullResponse)) !== null) {
        proposals.push({ id: Math.random().toString(36).substring(7), type: 'task', title: match[1].trim(), status: 'pending' });
      }
      while ((match = goalRegex.exec(fullResponse)) !== null) {
        proposals.push({ id: Math.random().toString(36).substring(7), type: 'goal', title: match[1].trim(), status: 'pending' });
      }
      
      let cleanText = fullResponse.replace(/\[TASK:\s*(.+?)\]/g, '').replace(/\[GOAL:\s*(.+?)\]/g, '').trim();

      // Append this agent's response to the history for the next agent
      currentHistory += `\\n\\n${agent.name}: ${cleanText}`;
      onAgentComplete(agentId, cleanText, proposals, createdFileName, createdFileContent);
    } catch (e: any) {
      const message = e?.message || e?.error?.message || (typeof e === 'string' ? e : JSON.stringify(e));
      const status = e?.status || e?.error?.status;
      
      if (message.includes('exceeded your current quota') || message.includes('check your plan and billing details') || message.includes('RESOURCE_EXHAUSTED') || status === 'RESOURCE_EXHAUSTED') {
        console.warn(`Agent ${agentId} hit quota limit.`);
        onStreamChunk(agentId, "\n*(I am unable to respond because the AI API quota has been exceeded. Please check your Gemini API plan and billing details.)*");
        onAgentComplete(agentId, "\n*(I am unable to respond because the AI API quota has been exceeded. Please check your Gemini API plan and billing details.)*");
      } else if (status === 'Internal Server Error' || message.includes('500') || message.includes('Internal Server Error')) {
        console.warn(`Agent ${agentId} encountered a server error (500).`);
        onStreamChunk(agentId, "\n*(I encountered a temporary server error. Please try again later.)*");
        onAgentComplete(agentId, "\n*(I encountered a temporary server error. Please try again later.)*");
      } else {
        console.error(`Failed to stream response for agent ${agentId}`, e);
        onStreamChunk(agentId, "\n*(Encountered an error while speaking)*");
        onAgentComplete(agentId, "\n*(Encountered an error while speaking)*");
      }
    }
  }
}

export async function generateSummary(
  company: CompanyContext,
  history: Message[],
  tasks: Task[],
  goals: Goal[],
  transcript: string
): Promise<string> {
  const systemInstruction = `You are an expert executive assistant. Your task is to generate a concise summary of a boardroom discussion.
  
  Company Context:
  Name: ${company.name}
  Description: ${company.description}
  
  The summary should highlight:
  1. Key Decisions: Important strategic decisions made during the discussion.
  2. Action Items: Specific tasks that need to be completed.
  3. Assigned Tasks: Tasks that were explicitly assigned to board members or the founder.
  
  Keep the summary professional, concise, and actionable. Use markdown.
  `;

  const chatHistoryText = history.map(msg => {
    const sender = msg.senderId === 'user' ? 'Founder' : msg.senderId;
    return `${sender}: ${msg.text}`;
  }).join("\n\n");

  const prompt = `Boardroom Discussion Transcript:\n${transcript}\n\nChat History:\n${chatHistoryText}\n\nActive Tasks:\n${tasks.map(t => `- ${t.title} (Status: ${t.status})`).join("\n")}\n\nActive Goals:\n${goals.map(g => `- ${g.objective}`).join("\n")}\n\nGenerate the summary.`;

  const response = await withRetry(async () => await getAiClient().models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction,
    },
  }));

  return response.text || "No summary could be generated.";
}
