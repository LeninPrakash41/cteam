import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import africastalking from "africastalking";
import { WebSocketServer } from "ws";
import http from "http";
import nodemailer from "nodemailer";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // WebSocket handling
  let frontendWs: any = null;

  wss.on("connection", (ws, req) => {
    const url = req.url;
    console.log(`WebSocket connected to: ${url}`);

    if (url === "/api/frontend/stream") {
      frontendWs = ws;
      console.log("Frontend WebSocket connected");
      ws.on("message", (message) => {
        const data = JSON.parse(message.toString());
        // Handle frontend audio if needed
      });
      ws.on("close", () => {
        frontendWs = null;
        console.log("Frontend WebSocket disconnected");
      });
    }
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/hubspot/contact", async (req, res) => {
    const { apiKey, email, firstname, lastname, phone } = req.body;
    
    if (!apiKey) {
      return res.status(401).json({ error: "Missing HubSpot API Key" });
    }

    try {
      const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          properties: {
            email,
            firstname,
            lastname,
            phone
          }
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to create contact in HubSpot');
      }

      res.json({ success: true, contact: data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Helper to find contact by email
  const getContactByEmail = async (apiKey: string, email: string) => {
    const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }]
      })
    });
    const data = await response.json();
    return data.results?.[0]?.id;
  };

  app.post("/api/hubspot/note", async (req, res) => {
    const { apiKey, email, noteBody } = req.body;
    if (!apiKey) return res.status(401).json({ error: "Missing HubSpot API Key" });

    try {
      const contactId = await getContactByEmail(apiKey, email);
      if (!contactId) throw new Error("Contact not found");

      const response = await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          properties: { hs_note_body: noteBody },
          associations: [{
            to: { id: contactId },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] // Note to Contact
          }]
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to create note');
      res.json({ success: true, note: data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/hubspot/task", async (req, res) => {
    const { apiKey, email, subject, body } = req.body;
    if (!apiKey) return res.status(401).json({ error: "Missing HubSpot API Key" });

    try {
      const contactId = await getContactByEmail(apiKey, email);
      if (!contactId) throw new Error("Contact not found");

      const response = await fetch('https://api.hubapi.com/crm/v3/objects/tasks', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          properties: {
            hs_task_subject: subject,
            hs_task_body: body,
            hs_task_status: "WAITING"
          },
          associations: [{
            to: { id: contactId },
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }] // Task to Contact
          }]
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to create task');
      res.json({ success: true, task: data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/hubspot/contacts/list", async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(401).json({ error: "Missing HubSpot API Key" });

    try {
      const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?properties=firstname,lastname,email,phone&limit=20', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to fetch contacts');
      
      const contacts = data.results.map((c: any) => ({
        id: c.id,
        firstname: c.properties.firstname,
        lastname: c.properties.lastname,
        email: c.properties.email,
        phone: c.properties.phone
      }));

      res.json({ success: true, contacts });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/hubspot/emails", async (req, res) => {
    const { apiKey, email } = req.body;
    if (!apiKey) return res.status(401).json({ error: "Missing HubSpot API Key" });
    if (!email) return res.status(400).json({ error: "Missing contact email" });

    try {
      const contactId = await getContactByEmail(apiKey, email);
      if (!contactId) throw new Error("Contact not found");

      // Get email associations
      const assocResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/emails`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      const assocData = await assocResponse.json();
      if (!assocResponse.ok) throw new Error(assocData.message || 'Failed to fetch email associations');

      if (!assocData.results || assocData.results.length === 0) {
        return res.json({ success: true, emails: [] });
      }

      const emailIds = assocData.results.map((r: any) => ({ id: r.id }));

      // Batch read emails
      const emailsResponse = await fetch('https://api.hubapi.com/crm/v3/objects/emails/batch/read', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: emailIds,
          properties: ["hs_email_subject", "hs_email_text", "hs_timestamp"]
        })
      });

      const emailsData = await emailsResponse.json();
      if (!emailsResponse.ok) throw new Error(emailsData.message || 'Failed to fetch emails');

      const emails = emailsData.results.map((e: any) => ({
        id: e.id,
        subject: e.properties.hs_email_subject,
        text: e.properties.hs_email_text,
        timestamp: e.properties.hs_timestamp
      }));

      res.json({ success: true, emails });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/email/send", async (req, res) => {
    const { zohoEmail, zohoPassword, hubspotApiKey, email, subject, body, companyName } = req.body;
    if (!zohoEmail || !zohoPassword) return res.status(401).json({ error: "Missing Zoho SMTP credentials. Please configure them in Integrations." });
    if (!email) return res.status(400).json({ error: "Missing contact email" });

    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.zoho.com',
        port: 465,
        secure: true,
        auth: {
          user: zohoEmail,
          pass: zohoPassword
        }
      });

      const htmlContent = `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <div style="text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #f3f4f6;">
            <h2 style="color: #111827; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em;">${companyName || 'C-Suite'}</h2>
          </div>
          <div style="color: #374151; line-height: 1.7; font-size: 16px;">
            ${body.replace(/\n/g, '<br>')}
          </div>
          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #f3f4f6; color: #9ca3af; font-size: 13px; text-align: center;">
            This email was sent on behalf of <strong>${companyName || 'C-Suite'}</strong> via AI C-Suite.
          </div>
        </div>
      `;

      await transporter.sendMail({
        from: zohoEmail,
        to: email,
        subject: subject,
        html: htmlContent
      });

      let hubspotLogged = false;
      if (hubspotApiKey) {
        try {
          const contactId = await getContactByEmail(hubspotApiKey, email);
          if (contactId) {
            await fetch('https://api.hubapi.com/crm/v3/objects/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${hubspotApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                properties: { 
                  hs_timestamp: Date.now().toString(),
                  hs_email_direction: "EMAIL",
                  hs_email_status: "SENT",
                  hs_email_subject: subject,
                  hs_email_text: body
                },
                associations: [{
                  to: { id: contactId },
                  types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 198 }]
                }]
              })
            });
            hubspotLogged = true;
          }
        } catch (hsError) {
          console.error("Failed to log to HubSpot", hsError);
        }
      }

      res.json({ success: true, message: "Email sent successfully", hubspotLogged });
    } catch (error: any) {
      console.error("Email send error:", error);
      res.status(500).json({ error: error.message || "Failed to send email" });
    }
  });

  app.use(express.urlencoded({ extended: true }));

  // In-memory store for active calls (for prototype purposes)
  const activeCalls = new Map<string, { company: any, objective: string, history: any[], phone?: string, firstPitch?: string }>();
  const callSummaries: any[] = [];

  app.get("/api/dialer/calls", (req, res) => {
    const companyId = req.query.companyId;
    if (companyId) {
      res.json(callSummaries.filter(c => c.companyId === companyId));
    } else {
      res.json(callSummaries);
    }
  });

  app.post("/api/dialer/call", async (req, res) => {
    const { apiKey, username, virtualNumber, phone, objective, company } = req.body;
    
    try {
      if (!apiKey || !username) {
        return res.status(400).json({ error: "Missing Africa's Talking credentials" });
      }
      
      const at = africastalking({ apiKey, username });
      const voice = at.VOICE;
      
      // Note: Africa's Talking requires a verified virtual number to make outbound calls.
      const fromNumber = virtualNumber || process.env.AFRICAS_TALKING_FROM_NUMBER || "+254711082000";
      
      // Format phone number to E.164 if it starts with 0
      let formattedPhone = phone;
      if (formattedPhone.startsWith('0')) {
        // Default to Nigerian code if it looks like a Nigerian number (11 digits starting with 070, 080, 090, 081, 091)
        if (formattedPhone.length === 11) {
          formattedPhone = '+234' + formattedPhone.substring(1);
        } else if (formattedPhone.length === 10) {
          // Default to Kenyan code if it looks like a Kenyan number (10 digits starting with 07 or 01)
          formattedPhone = '+254' + formattedPhone.substring(1);
        }
      }
      
      const result = await voice.call({
        callFrom: fromNumber,
        callTo: [formattedPhone]
      });
      
      // Store the call context for the webhook
      if (result && result.entries && result.entries.length > 0) {
        const sessionId = result.entries[0].sessionId;
        const callContext = { company, objective, history: [], phone: formattedPhone, firstPitch: "Hello?" };
        activeCalls.set(sessionId, callContext);
        
        // Pre-generate the first pitch asynchronously so it's ready when they pick up
        const prompt = `You are the CMO of ${company.name} (${company.industry}). 
        Company description: ${company.description}
        You are making an outbound phone call to a lead. 
        Your objective for this call is: ${objective}
        
        Start the conversation naturally. Pitch the product based on the objective. Keep it brief, conversational, and end with a question to engage them. Do not use emojis or special characters.`;
        
        generateVoiceResponse(prompt, []).then(pitch => {
          if (activeCalls.has(sessionId)) {
            activeCalls.get(sessionId)!.firstPitch = pitch;
          }
        }).catch(err => console.error("Failed to pre-generate pitch:", err));
      }
      
      res.json({ success: true, message: "Call initiated", result });
    } catch (error: any) {
      console.error("Africa's Talking call error:", error);
      res.status(500).json({ error: error.message || "Failed to initiate call via Africa's Talking" });
    }
  });

  // Helper to call Gemini for voice
  async function generateVoiceResponse(prompt: string, history: any[], audioUrl?: string) {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    let contents: any[] = [...history];
    
    let currentUserParts: any[] = [];
    
    if (audioUrl) {
      try {
        const audioRes = await fetch(audioUrl);
        const audioBuffer = await audioRes.arrayBuffer();
        const mimeType = audioRes.headers.get('content-type') || 'audio/mp3';
        const base64Audio = Buffer.from(audioBuffer).toString('base64');
        
        currentUserParts.push({ inlineData: { data: base64Audio, mimeType } });
      } catch (e) {
        console.error("Failed to fetch audio from AT:", e);
        currentUserParts.push({ text: "(User spoke, but audio could not be retrieved)" });
      }
    }
    
    // Add the system prompt to enforce behavior
    currentUserParts.push({ text: prompt });
    
    contents.push({
      role: 'user',
      parts: currentUserParts
    });

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents
      });
      
      const text = response.text || "I'm sorry, I didn't catch that.";
      // Clean up text for TTS (remove markdown, emojis, escape XML)
      let cleanText = text.replace(/[*_#`]/g, '').replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
      cleanText = cleanText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return cleanText;
    } catch (e) {
      console.error("Gemini voice generation error:", e);
      return "I'm sorry, I am having trouble connecting to my brain right now.";
    }
  }

  // Africa's Talking Voice Callback Webhook
  app.post("/api/at/voice", async (req, res) => {
    console.log("Received incoming call webhook from Africa's Talking", req.body);
    const { sessionId, isActive, recordingUrl, callerNumber, destinationNumber } = req.body;
    
    // Log to file for debugging
    try {
      fs.appendFileSync('at_webhook.log', JSON.stringify({ body: req.body, headers: req.headers }) + '\n');
    } catch (e) {
      console.error("Failed to write to log file", e);
    }
    
    if (isActive === '0') {
      let callContext = activeCalls.get(sessionId);
      if (!callContext) {
        for (const [key, value] of activeCalls.entries()) {
          if (value.phone === destinationNumber || value.phone === callerNumber) {
            callContext = value;
            break;
          }
        }
      }
      
      if (callContext) {
        // Generate summary
        try {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const summaryPrompt = `Summarize this phone call transcript. Objective was: ${callContext.objective}. What was the outcome? Keep it brief.`;
          const contents = [...callContext.history, { role: 'user', parts: [{ text: summaryPrompt }] }];
          const response = await ai.models.generateContent({
            model: "gemini-3.1-pro-preview",
            contents
          });
          
          callSummaries.push({
            id: Date.now().toString(),
            companyId: callContext.company.id,
            phone: callContext.phone,
            objective: callContext.objective,
            summary: response.text || "Call completed.",
            timestamp: new Date().toISOString()
          });
        } catch (e) {
          console.error("Failed to summarize call:", e);
          callSummaries.push({
            id: Date.now().toString(),
            companyId: callContext.company.id,
            phone: callContext.phone,
            objective: callContext.objective,
            summary: "Call completed but summary failed to generate.",
            timestamp: new Date().toISOString()
          });
        }
      }
      
      activeCalls.delete(sessionId);
      res.type('application/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    // Try to find call context by sessionId or destinationNumber
    let callContext = activeCalls.get(sessionId);
    if (!callContext) {
      // Fallback: find by destination number
      for (const [key, value] of activeCalls.entries()) {
        if (value.phone === destinationNumber || value.phone === callerNumber) {
          callContext = value;
          // Update the session ID to the new one
          activeCalls.set(sessionId, callContext);
          break;
        }
      }
    }

    if (!callContext) {
      try {
        fs.appendFileSync('at_webhook.log', 'Call context not found for session: ' + sessionId + '\n');
      } catch (e) {}
      res.type('application/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an error occurred.</Say></Response>');
    }

    let aiResponseText = "";

    if (!recordingUrl && callContext.history.length === 0) {
      // First turn
      if (callContext.firstPitch) {
        aiResponseText = callContext.firstPitch;
      } else {
        const prompt = `You are the CMO of ${callContext.company.name} (${callContext.company.industry}). 
        Company description: ${callContext.company.description}
        You are making an outbound phone call to a lead. 
        Your objective for this call is: ${callContext.objective}
        
        Start the conversation naturally. Pitch the product based on the objective. Keep it brief, conversational, and end with a question to engage them. Do not use emojis or special characters.`;
        
        aiResponseText = await generateVoiceResponse(prompt, callContext.history);
      }
      callContext.history.push({ role: 'user', parts: [{ text: "Call started." }] });
      callContext.history.push({ role: 'model', parts: [{ text: aiResponseText }] });
    } else if (recordingUrl) {
      // User spoke
      const prompt = `You are the CMO of ${callContext.company.name}. You are on a phone call. 
      Objective: ${callContext.objective}
      The user just spoke. Listen to their audio and respond naturally, gracefully handling any interruptions or objections. Keep it conversational, brief, and persuasive. Do not use emojis or special characters.`;
      
      aiResponseText = await generateVoiceResponse(prompt, callContext.history, recordingUrl);
      
      // We don't push the audio to history to save context window, we just push the text representation
      callContext.history.push({ role: 'user', parts: [{ text: "(User spoke)" }] });
      callContext.history.push({ role: 'model', parts: [{ text: aiResponseText }] });
    } else {
      aiResponseText = "I didn't catch that. Could you repeat?";
    }

    const response = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>${aiResponseText}</Say>
        <Record playBeep="false" trimSilence="true" />
      </Response>`;
    
    res.type('application/xml');
    res.send(response);
  });

  // Africa's Talking Account Verification Ping (Sends a dummy SMS to trigger account verification)
  app.post("/api/at/verify", async (req, res) => {
    const { apiKey, username } = req.body;
    try {
      if (!apiKey || !username) {
        return res.status(400).json({ error: "Missing credentials" });
      }
      const at = africastalking({ apiKey, username });
      const sms = at.SMS;
      const application = at.APPLICATION;
      
      let appData = null;
      let appDataError = null;
      try {
        appData = await application.fetchApplicationData();
      } catch (e: any) {
        console.log("App data fetch failed:", e);
        appDataError = e.message;
      }
      
      let smsResult = null;
      let smsError = null;
      try {
        // Send a dummy SMS to a sandbox number to trigger API activity
        smsResult = await sms.send({
          to: ['+254700000000'],
          message: 'Account verification ping from AI Studio'
        });
      } catch (e: any) {
        console.log("SMS send failed:", e);
        smsError = e.message;
      }
      
      if (!appData && !smsResult) {
        return res.status(500).json({ 
          error: "Both App Data fetch and SMS ping failed. Check your credentials.",
          details: { appDataError, smsError }
        });
      }
      
      res.json({ success: true, message: "API Ping successful", result: smsResult, appData });
    } catch (error: any) {
      console.error("Africa's Talking verify error:", error);
      res.status(500).json({ error: error.message || "Failed to ping API" });
    }
  });

  // API routes MUST go before Vite middleware
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
