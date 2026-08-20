import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import africastalking from "africastalking";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import nodemailer from "nodemailer";
import pg from "pg";

const { Pool } = pg;

// PostgreSQL Database Connection & Memory Fallback
const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/cteam";
let pool: pg.Pool | null = null;
let usePostgres = false;

// Fallback in-memory DB if PostgreSQL instance is not reachable locally
const memoryDb: {
  users: Map<string, any>;
  companies: Map<string, any>;
  agents: Map<string, any>;
  messages: Map<string, any>;
  tasks: Map<string, any>;
  goals: Map<string, any>;
  assets: Map<string, any>;
  resolutions: Map<string, any>;
} = {
  users: new Map(),
  companies: new Map(),
  agents: new Map(),
  messages: new Map(),
  tasks: new Map(),
  goals: new Map(),
  assets: new Map(),
  resolutions: new Map()
};

memoryDb.users.set('admin_01', { id: 'admin_01', email: 'admin@csuite.ai', password: 'AdminPassword123!', name: 'System Admin', avatarUrl: 'https://picsum.photos/seed/admin/200' });
memoryDb.users.set('user_default_123', { id: 'user_default_123', email: 'founder@example.com', password: 'FounderPassword123!', name: 'Founder', avatarUrl: 'https://picsum.photos/seed/founder/200' });

async function initDatabase() {
  try {
    pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 3000
    });
    const client = await pool.connect();
    console.log("Connected to PostgreSQL database successfully.");
    
    // Create PostgreSQL tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT,
        avatar_url TEXT,
        created_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        name TEXT,
        industry TEXT,
        category TEXT,
        description TEXT,
        integrations JSONB DEFAULT '{}'::jsonb,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        role TEXT,
        name TEXT,
        bio TEXT,
        expertise JSONB DEFAULT '[]'::jsonb,
        avatar_url TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        sender_id TEXT,
        text TEXT,
        file_name TEXT,
        file_content TEXT,
        proposals JSONB DEFAULT '[]'::jsonb,
        timestamp BIGINT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        title TEXT,
        description TEXT,
        assigned_to TEXT,
        status TEXT,
        created_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        objective TEXT,
        smart_goals JSONB DEFAULT '[]'::jsonb,
        kpis JSONB DEFAULT '[]'::jsonb,
        created_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        name TEXT,
        content TEXT,
        created_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS resolutions (
        id TEXT PRIMARY KEY,
        company_id TEXT,
        resolution_number TEXT,
        title TEXT,
        category TEXT,
        content TEXT,
        proposed_by TEXT,
        status TEXT,
        votes JSONB DEFAULT '[]'::jsonb,
        passed_at BIGINT,
        created_at BIGINT
      );

      -- Seed Default Admin & Founder accounts with passwords
      INSERT INTO users (id, email, password, name, avatar_url, created_at)
      VALUES 
        ('admin_01', 'admin@csuite.ai', 'AdminPassword123!', 'System Admin', 'https://picsum.photos/seed/admin/200', 1700000000000),
        ('user_default_123', 'founder@example.com', 'FounderPassword123!', 'Founder', 'https://picsum.photos/seed/founder/200', 1700000000000)
      ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password;
    `);
    client.release();
    usePostgres = true;
    console.log("PostgreSQL tables verified.");
  } catch (err) {
    console.warn("PostgreSQL connection unavailable, using application fallback database adapter:", err instanceof Error ? err.message : err);
    usePostgres = false;
  }
}

async function startServer() {
  await initDatabase();

  const app = express();
  const PORT = 3000;
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // WebSocket handling & Broadcasting
  const connectedClients = new Set<WebSocket>();

  wss.on("connection", (ws, req) => {
    const url = req.url;
    console.log(`WebSocket connected to: ${url}`);
    connectedClients.add(ws);

    ws.on("close", () => {
      connectedClients.delete(ws);
      console.log("WebSocket disconnected");
    });
  });

  function broadcastChange(event: string, payload: any) {
    const message = JSON.stringify({ type: event, payload });
    connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // --- POSTGRESQL REST API ENDPOINTS ---

  // Auth
  app.post("/api/auth/login", async (req, res) => {
    const { id, email, name, avatarUrl } = req.body;
    const userId = id || 'user_default_123';
    const createdAt = Date.now();

    if (usePostgres && pool) {
      try {
        await pool.query(
          `INSERT INTO users (id, email, name, avatar_url, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url`,
          [userId, email || 'founder@example.com', name || 'Founder', avatarUrl || '', createdAt]
        );
      } catch (e: any) {
        console.error("PG Auth error:", e);
      }
    }
    
    const user = { id: userId, email: email || 'founder@example.com', name: name || 'Founder', avatarUrl: avatarUrl || '' };
    memoryDb.users.set(userId, user);
    res.json({ success: true, user });
  });

  // Companies
  app.get("/api/companies", async (req, res) => {
    const ownerId = req.query.ownerId as string;
    if (usePostgres && pool) {
      try {
        const result = await pool.query(`SELECT * FROM companies WHERE owner_id = $1 ORDER BY created_at DESC`, [ownerId]);
        const companies = result.rows.map(r => ({
          id: r.id,
          ownerId: r.owner_id,
          name: r.name,
          industry: r.industry,
          category: r.category,
          description: r.description,
          integrations: r.integrations,
          createdAt: r.created_at
        }));
        return res.json({ companies });
      } catch (e: any) {
        console.error("PG Get Companies error:", e);
      }
    }

    const list = Array.from(memoryDb.companies.values()).filter(c => !ownerId || c.ownerId === ownerId);
    res.json({ companies: list });
  });

  app.post("/api/companies", async (req, res) => {
    const company = req.body;
    if (usePostgres && pool) {
      try {
        await pool.query(
          `INSERT INTO companies (id, owner_id, name, industry, category, description, integrations, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, industry = EXCLUDED.industry, category = EXCLUDED.category, description = EXCLUDED.description, integrations = EXCLUDED.integrations`,
          [company.id, company.ownerId, company.name, company.industry, company.category, company.description, JSON.stringify(company.integrations || {}), company.createdAt]
        );
      } catch (e: any) {
        console.error("PG Create Company error:", e);
      }
    }

    memoryDb.companies.set(company.id, company);
    broadcastChange("company_updated", company);
    res.json({ success: true, company });
  });

  app.patch("/api/companies/:id", async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    let existing = memoryDb.companies.get(id) || { id };
    const updated = { ...existing, ...updates };

    if (usePostgres && pool) {
      try {
        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (updates.description !== undefined) { fields.push(`description = $${idx++}`); values.push(updates.description); }
        if (updates.integrations !== undefined) { fields.push(`integrations = $${idx++}`); values.push(JSON.stringify(updates.integrations)); }
        if (updates.name !== undefined) { fields.push(`name = $${idx++}`); values.push(updates.name); }

        if (fields.length > 0) {
          values.push(id);
          await pool.query(`UPDATE companies SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        }
      } catch (e: any) {
        console.error("PG Patch Company error:", e);
      }
    }

    memoryDb.companies.set(id, updated);
    broadcastChange("company_updated", updated);
    res.json({ success: true, company: updated });
  });

  // Agents
  app.get("/api/companies/:companyId/agents", async (req, res) => {
    const { companyId } = req.params;
    if (usePostgres && pool) {
      try {
        const result = await pool.query(`SELECT * FROM agents WHERE company_id = $1`, [companyId]);
        const agents = result.rows.map(r => ({
          id: r.id,
          companyId: r.company_id,
          role: r.role,
          name: r.name,
          bio: r.bio,
          expertise: r.expertise,
          avatarUrl: r.avatar_url,
          createdAt: r.created_at
        }));
        return res.json({ agents });
      } catch (e: any) {
        console.error("PG Get Agents error:", e);
      }
    }

    const agents = Array.from(memoryDb.agents.values()).filter(a => a.companyId === companyId);
    res.json({ agents });
  });

  app.post("/api/companies/:companyId/agents", async (req, res) => {
    const { companyId } = req.params;
    const { agents } = req.body;

    const items = Array.isArray(agents) ? agents : [agents];

    if (usePostgres && pool) {
      try {
        for (const agent of items) {
          await pool.query(
            `INSERT INTO agents (id, company_id, role, name, bio, expertise, avatar_url, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name, bio = EXCLUDED.bio, expertise = EXCLUDED.expertise, avatar_url = EXCLUDED.avatar_url`,
            [agent.id, companyId, agent.role, agent.name, agent.bio, JSON.stringify(agent.expertise || []), agent.avatarUrl, agent.createdAt || new Date().toISOString()]
          );
        }
      } catch (e: any) {
        console.error("PG Post Agents error:", e);
      }
    }

    items.forEach(agent => memoryDb.agents.set(agent.id, { ...agent, companyId }));
    broadcastChange("agents_updated", { companyId });
    res.json({ success: true });
  });

  app.patch("/api/agents/:id", async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    let existing = memoryDb.agents.get(id) || { id };
    const updated = { ...existing, ...updates };

    if (usePostgres && pool) {
      try {
        if (updates.avatarUrl) {
          await pool.query(`UPDATE agents SET avatar_url = $1 WHERE id = $2`, [updates.avatarUrl, id]);
        }
      } catch (e: any) {
        console.error("PG Patch Agent error:", e);
      }
    }

    memoryDb.agents.set(id, updated);
    broadcastChange("agents_updated", { companyId: updated.companyId });
    res.json({ success: true, agent: updated });
  });

  // Messages
  app.get("/api/companies/:companyId/messages", async (req, res) => {
    const { companyId } = req.params;
    if (usePostgres && pool) {
      try {
        const result = await pool.query(`SELECT * FROM messages WHERE company_id = $1 ORDER BY timestamp ASC`, [companyId]);
        const messages = result.rows.map(r => ({
          id: r.id,
          companyId: r.company_id,
          senderId: r.sender_id,
          text: r.text,
          fileName: r.file_name,
          fileContent: r.file_content,
          proposals: typeof r.proposals === 'string' ? JSON.parse(r.proposals) : (r.proposals || []),
          timestamp: Number(r.timestamp)
        }));
        return res.json({ messages });
      } catch (e: any) {
        console.error("PG Get Messages error:", e);
      }
    }

    const messages = Array.from(memoryDb.messages.values())
      .filter(m => m.companyId === companyId)
      .sort((a, b) => a.timestamp - b.timestamp);
    res.json({ messages });
  });

  app.post("/api/companies/:companyId/messages", async (req, res) => {
    const { companyId } = req.params;
    const msg = req.body;

    if (usePostgres && pool) {
      try {
        await pool.query(
          `INSERT INTO messages (id, company_id, sender_id, text, file_name, file_content, proposals, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [msg.id, companyId, msg.senderId, msg.text || '', msg.fileName || null, msg.fileContent || null, JSON.stringify(msg.proposals || []), msg.timestamp]
        );
      } catch (e: any) {
        console.error("PG Post Message error:", e);
      }
    }

    memoryDb.messages.set(msg.id, { ...msg, companyId });
    broadcastChange("messages_updated", { companyId, message: msg });
    res.json({ success: true, message: msg });
  });

  app.patch("/api/messages/:id", async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    let existing = memoryDb.messages.get(id) || { id };
    const updated = { ...existing, ...updates };

    if (usePostgres && pool) {
      try {
        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (updates.text !== undefined) { fields.push(`text = $${idx++}`); values.push(updates.text); }
        if (updates.proposals !== undefined) { fields.push(`proposals = $${idx++}`); values.push(JSON.stringify(updates.proposals)); }

        if (fields.length > 0) {
          values.push(id);
          await pool.query(`UPDATE messages SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        }
      } catch (e: any) {
        console.error("PG Patch Message error:", e);
      }
    }

    memoryDb.messages.set(id, updated);
    broadcastChange("messages_updated", { companyId: updated.companyId });
    res.json({ success: true, message: updated });
  });

  app.delete("/api/companies/:companyId/messages", async (req, res) => {
    const { companyId } = req.params;

    if (usePostgres && pool) {
      try {
        await pool.query(`DELETE FROM messages WHERE company_id = $1`, [companyId]);
      } catch (e: any) {
        console.error("PG Delete Messages error:", e);
      }
    }

    for (const [id, msg] of memoryDb.messages.entries()) {
      if (msg.companyId === companyId) {
        memoryDb.messages.delete(id);
      }
    }

    broadcastChange("messages_updated", { companyId });
    res.json({ success: true });
  });

  // Tasks
  app.get("/api/companies/:companyId/tasks", async (req, res) => {
    const { companyId } = req.params;
    if (usePostgres && pool) {
      try {
        const result = await pool.query(`SELECT * FROM tasks WHERE company_id = $1 ORDER BY created_at DESC`, [companyId]);
        const tasks = result.rows.map(r => ({
          id: r.id,
          companyId: r.company_id,
          title: r.title,
          description: r.description,
          assignedTo: r.assigned_to,
          status: r.status,
          createdAt: Number(r.created_at)
        }));
        return res.json({ tasks });
      } catch (e: any) {
        console.error("PG Get Tasks error:", e);
      }
    }

    const tasks = Array.from(memoryDb.tasks.values())
      .filter(t => t.companyId === companyId)
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ tasks });
  });

  app.post("/api/companies/:companyId/tasks", async (req, res) => {
    const { companyId } = req.params;
    const task = req.body;

    if (usePostgres && pool) {
      try {
        await pool.query(
          `INSERT INTO tasks (id, company_id, title, description, assigned_to, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, assigned_to = EXCLUDED.assigned_to, status = EXCLUDED.status`,
          [task.id, companyId, task.title, task.description || '', task.assignedTo || 'user', task.status || 'pending', task.createdAt || Date.now()]
        );
      } catch (e: any) {
        console.error("PG Post Task error:", e);
      }
    }

    memoryDb.tasks.set(task.id, { ...task, companyId });
    broadcastChange("tasks_updated", { companyId });
    res.json({ success: true, task });
  });

  app.patch("/api/tasks/:id", async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    let existing = memoryDb.tasks.get(id) || { id };
    const updated = { ...existing, ...updates };

    if (usePostgres && pool) {
      try {
        if (updates.status) {
          await pool.query(`UPDATE tasks SET status = $1 WHERE id = $2`, [updates.status, id]);
        }
      } catch (e: any) {
        console.error("PG Patch Task error:", e);
      }
    }

    memoryDb.tasks.set(id, updated);
    broadcastChange("tasks_updated", { companyId: updated.companyId });
    res.json({ success: true, task: updated });
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    const { id } = req.params;
    const existing = memoryDb.tasks.get(id);

    if (usePostgres && pool) {
      try {
        await pool.query(`DELETE FROM tasks WHERE id = $1`, [id]);
      } catch (e: any) {
        console.error("PG Delete Task error:", e);
      }
    }

    memoryDb.tasks.delete(id);
    broadcastChange("tasks_updated", { companyId: existing?.companyId });
    res.json({ success: true });
  });

  // Goals
  app.get("/api/companies/:companyId/goals", async (req, res) => {
    const { companyId } = req.params;
    if (usePostgres && pool) {
      try {
        const result = await pool.query(`SELECT * FROM goals WHERE company_id = $1 ORDER BY created_at DESC`, [companyId]);
        const goals = result.rows.map(r => ({
          id: r.id,
          companyId: r.company_id,
          objective: r.objective,
          smartGoals: r.smart_goals,
          kpis: r.kpis,
          createdAt: Number(r.created_at)
        }));
        return res.json({ goals });
      } catch (e: any) {
        console.error("PG Get Goals error:", e);
      }
    }

    const goals = Array.from(memoryDb.goals.values())
      .filter(g => g.companyId === companyId)
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ goals });
  });

  app.post("/api/companies/:companyId/goals", async (req, res) => {
    const { companyId } = req.params;
    const goal = req.body;

    if (usePostgres && pool) {
      try {
        await pool.query(
          `INSERT INTO goals (id, company_id, objective, smart_goals, kpis, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET objective = EXCLUDED.objective, smart_goals = EXCLUDED.smart_goals, kpis = EXCLUDED.kpis`,
          [goal.id, companyId, goal.objective, JSON.stringify(goal.smartGoals || []), JSON.stringify(goal.kpis || []), goal.createdAt || Date.now()]
        );
      } catch (e: any) {
        console.error("PG Post Goal error:", e);
      }
    }

    memoryDb.goals.set(goal.id, { ...goal, companyId });
    broadcastChange("goals_updated", { companyId });
    res.json({ success: true, goal });
  });

  app.patch("/api/goals/:id", async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    let existing = memoryDb.goals.get(id) || { id };
    const updated = { ...existing, ...updates };

    if (usePostgres && pool) {
      try {
        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (updates.smartGoals !== undefined) { fields.push(`smart_goals = $${idx++}`); values.push(JSON.stringify(updates.smartGoals)); }
        if (updates.kpis !== undefined) { fields.push(`kpis = $${idx++}`); values.push(JSON.stringify(updates.kpis)); }

        if (fields.length > 0) {
          values.push(id);
          await pool.query(`UPDATE goals SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        }
      } catch (e: any) {
        console.error("PG Patch Goal error:", e);
      }
    }

    memoryDb.goals.set(id, updated);
    broadcastChange("goals_updated", { companyId: updated.companyId });
    res.json({ success: true, goal: updated });
  });

  app.delete("/api/goals/:id", async (req, res) => {
    const { id } = req.params;
    const existing = memoryDb.goals.get(id);

    if (usePostgres && pool) {
      try {
        await pool.query(`DELETE FROM goals WHERE id = $1`, [id]);
      } catch (e: any) {
        console.error("PG Delete Goal error:", e);
      }
    }

    memoryDb.goals.delete(id);
    broadcastChange("goals_updated", { companyId: existing?.companyId });
    res.json({ success: true });
  });

  // Assets
  app.get("/api/companies/:companyId/assets", async (req, res) => {
    const { companyId } = req.params;
    if (usePostgres && pool) {
      try {
        const result = await pool.query(`SELECT * FROM assets WHERE company_id = $1 ORDER BY created_at DESC`, [companyId]);
        const assets = result.rows.map(r => ({
          id: r.id,
          companyId: r.company_id,
          name: r.name,
          content: r.content,
          createdAt: Number(r.created_at)
        }));
        return res.json({ assets });
      } catch (e: any) {
        console.error("PG Get Assets error:", e);
      }
    }

    const assets = Array.from(memoryDb.assets.values())
      .filter(a => a.companyId === companyId)
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ assets });
  });

  app.post("/api/companies/:companyId/assets", async (req, res) => {
    const { companyId } = req.params;
    const asset = req.body;

    if (usePostgres && pool) {
      try {
        await pool.query(
          `INSERT INTO assets (id, company_id, name, content, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, content = EXCLUDED.content`,
          [asset.id, companyId, asset.name, asset.content, asset.createdAt || Date.now()]
        );
      } catch (e: any) {
        console.error("PG Post Asset error:", e);
      }
    }

    memoryDb.assets.set(asset.id, { ...asset, companyId });
    broadcastChange("assets_updated", { companyId });
    res.json({ success: true, asset });
  });

  app.delete("/api/assets/:id", async (req, res) => {
    const { id } = req.params;
    const existing = memoryDb.assets.get(id);

    if (usePostgres && pool) {
      try {
        await pool.query(`DELETE FROM assets WHERE id = $1`, [id]);
      } catch (e: any) {
        console.error("PG Delete Asset error:", e);
      }
    }

    memoryDb.assets.delete(id);
    broadcastChange("assets_updated", { companyId: existing?.companyId });
    res.json({ success: true });
  });

  // Resolutions
  app.get("/api/companies/:companyId/resolutions", async (req, res) => {
    const { companyId } = req.params;
    if (usePostgres && pool) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS resolutions (
            id TEXT PRIMARY KEY,
            company_id TEXT,
            resolution_number TEXT,
            title TEXT,
            category TEXT,
            content TEXT,
            proposed_by TEXT,
            status TEXT,
            votes JSONB DEFAULT '[]'::jsonb,
            passed_at BIGINT,
            created_at BIGINT
          );
        `);
        const result = await pool.query(`SELECT * FROM resolutions WHERE company_id = $1 ORDER BY created_at DESC`, [companyId]);
        const resolutions = result.rows.map(r => {
          let parsedVotes: any[] = [];
          if (Array.isArray(r.votes)) {
            parsedVotes = r.votes;
          } else if (typeof r.votes === 'string') {
            try { parsedVotes = JSON.parse(r.votes); } catch (e) { parsedVotes = []; }
          }
          return {
            id: r.id,
            companyId: r.company_id,
            resolutionNumber: r.resolution_number || '',
            title: r.title || '',
            category: r.category || 'Strategic',
            content: r.content || '',
            proposedBy: r.proposed_by || 'Founder',
            status: r.status || 'Draft',
            votes: parsedVotes,
            passedAt: r.passed_at ? Number(r.passed_at) : undefined,
            createdAt: Number(r.created_at || Date.now())
          };
        });
        return res.json({ resolutions });
      } catch (e: any) {
        console.error("PG Get Resolutions error:", e);
      }
    }

    try {
      const resolutions = Array.from((memoryDb.resolutions || new Map()).values())
        .filter(r => r && r.companyId === companyId)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return res.json({ resolutions: resolutions || [] });
    } catch (e: any) {
      return res.json({ resolutions: [] });
    }
  });

  app.post("/api/companies/:companyId/resolutions", async (req, res) => {
    const { companyId } = req.params;
    const resolution = req.body || {};

    if (usePostgres && pool) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS resolutions (
            id TEXT PRIMARY KEY,
            company_id TEXT,
            resolution_number TEXT,
            title TEXT,
            category TEXT,
            content TEXT,
            proposed_by TEXT,
            status TEXT,
            votes JSONB DEFAULT '[]'::jsonb,
            passed_at BIGINT,
            created_at BIGINT
          );
        `);
        await pool.query(
          `INSERT INTO resolutions (id, company_id, resolution_number, title, category, content, proposed_by, status, votes, passed_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET 
             title = EXCLUDED.title,
             category = EXCLUDED.category,
             content = EXCLUDED.content,
             status = EXCLUDED.status,
             votes = EXCLUDED.votes,
             passed_at = EXCLUDED.passed_at`,
          [
            resolution.id,
            companyId,
            resolution.resolutionNumber || `RES-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
            resolution.title || '',
            resolution.category || 'Strategic',
            resolution.content || '',
            resolution.proposedBy || 'Founder',
            resolution.status || 'Draft',
            JSON.stringify(resolution.votes || []),
            resolution.passedAt || null,
            resolution.createdAt || Date.now()
          ]
        );
      } catch (e: any) {
        console.error("PG Post Resolution error:", e);
      }
    }

    if (memoryDb.resolutions) {
      memoryDb.resolutions.set(resolution.id, { ...resolution, companyId });
    }
    broadcastChange("resolutions_updated", { companyId });
    return res.json({ success: true, resolution });
  });

  app.patch("/api/resolutions/:id", async (req, res) => {
    const { id } = req.params;
    const updates = req.body || {};

    let existing = (memoryDb.resolutions ? memoryDb.resolutions.get(id) : null) || { id };
    const updated = { ...existing, ...updates };

    if (usePostgres && pool) {
      try {
        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (updates.title !== undefined) { fields.push(`title = $${idx++}`); values.push(updates.title); }
        if (updates.category !== undefined) { fields.push(`category = $${idx++}`); values.push(updates.category); }
        if (updates.content !== undefined) { fields.push(`content = $${idx++}`); values.push(updates.content); }
        if (updates.status !== undefined) { fields.push(`status = $${idx++}`); values.push(updates.status); }
        if (updates.votes !== undefined) { fields.push(`votes = $${idx++}`); values.push(JSON.stringify(updates.votes)); }
        if (updates.passedAt !== undefined) { fields.push(`passed_at = $${idx++}`); values.push(updates.passedAt); }

        if (fields.length > 0) {
          values.push(id);
          await pool.query(`UPDATE resolutions SET ${fields.join(', ')} WHERE id = $${idx}`, values);
        }
      } catch (e: any) {
        console.error("PG Patch Resolution error:", e);
      }
    }

    if (memoryDb.resolutions) {
      memoryDb.resolutions.set(id, updated);
    }
    broadcastChange("resolutions_updated", { companyId: updated.companyId });
    return res.json({ success: true, resolution: updated });
  });

  app.delete("/api/resolutions/:id", async (req, res) => {
    const { id } = req.params;
    const existing = memoryDb.resolutions ? memoryDb.resolutions.get(id) : null;

    if (usePostgres && pool) {
      try {
        await pool.query(`DELETE FROM resolutions WHERE id = $1`, [id]);
      } catch (e: any) {
        console.error("PG Delete Resolution error:", e);
      }
    }

    if (memoryDb.resolutions) {
      memoryDb.resolutions.delete(id);
    }
    broadcastChange("resolutions_updated", { companyId: existing?.companyId });
    return res.json({ success: true });
  });

  // --- EXISTING HUBSPOT & THIRD-PARTY TOOL APIS ---

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
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }]
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
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }]
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
      const fromNumber = virtualNumber || process.env.AFRICAS_TALKING_FROM_NUMBER || "+254711082000";
      
      let formattedPhone = phone;
      if (formattedPhone.startsWith('0')) {
        if (formattedPhone.length === 11) {
          formattedPhone = '+234' + formattedPhone.substring(1);
        } else if (formattedPhone.length === 10) {
          formattedPhone = '+254' + formattedPhone.substring(1);
        }
      }
      
      const result = await voice.call({
        callFrom: fromNumber,
        callTo: [formattedPhone]
      });
      
      if (result && result.entries && result.entries.length > 0) {
        const sessionId = result.entries[0].sessionId;
        const callContext = { company, objective, history: [], phone: formattedPhone, firstPitch: "Hello?" };
        activeCalls.set(sessionId, callContext);
        
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
    
    currentUserParts.push({ text: prompt });
    contents.push({ role: 'user', parts: currentUserParts });

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents
      });
      
      const text = response.text || "I'm sorry, I didn't catch that.";
      let cleanText = text.replace(/[*_#`]/g, '').replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
      cleanText = cleanText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return cleanText;
    } catch (e) {
      console.error("Gemini voice generation error:", e);
      return "I'm sorry, I am having trouble connecting to my brain right now.";
    }
  }

  app.post("/api/at/voice", async (req, res) => {
    console.log("Received incoming call webhook from Africa's Talking", req.body);
    const { sessionId, isActive, recordingUrl, callerNumber, destinationNumber } = req.body;
    
    try {
      fs.appendFileSync('at_webhook.log', JSON.stringify({ body: req.body, headers: req.headers }) + '\n');
    } catch (e) {}
    
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

    let callContext = activeCalls.get(sessionId);
    if (!callContext) {
      for (const [key, value] of activeCalls.entries()) {
        if (value.phone === destinationNumber || value.phone === callerNumber) {
          callContext = value;
          activeCalls.set(sessionId, callContext);
          break;
        }
      }
    }

    if (!callContext) {
      res.type('application/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an error occurred.</Say></Response>');
    }

    let aiResponseText = "";
    if (!recordingUrl && callContext.history.length === 0) {
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
      const prompt = `You are the CMO of ${callContext.company.name}. You are on a phone call. 
      Objective: ${callContext.objective}
      The user just spoke. Listen to their audio and respond naturally, gracefully handling any interruptions or objections. Keep it conversational, brief, and persuasive. Do not use emojis or special characters.`;
      
      aiResponseText = await generateVoiceResponse(prompt, callContext.history, recordingUrl);
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
        appDataError = e.message;
      }
      
      let smsResult = null;
      let smsError = null;
      try {
        smsResult = await sms.send({
          to: ['+254700000000'],
          message: 'Account verification ping from AI Studio'
        });
      } catch (e: any) {
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
      res.status(500).json({ error: error.message || "Failed to ping API" });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", postgres: usePostgres });
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
