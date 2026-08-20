import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { Agent, CompanyContext, Message, Task, Goal, MarketingAsset, BoardResolution } from './types';
import { AuthUser, getStoredUser, apiFetch } from './db';

interface CSuiteContextType {
  user: AuthUser | null;
  authReady: boolean;
  company: CompanyContext | null;
  companyLoading: boolean;
  setCompany: (company: CompanyContext | null) => void;
  updateCompany: (updates: Partial<CompanyContext>) => Promise<void>;
  team: Agent[];
  setTeam: (team: Agent[]) => void;
  updateAgent: (agentId: string, updates: Partial<Agent>) => Promise<void>;
  messages: Message[];
  addMessage: (message: Message) => Promise<void>;
  updateMessage: (messageId: string, updates: Partial<Message>) => Promise<void>;
  clearMessages: () => void;
  tasks: Task[];
  addTask: (task: Task) => Promise<void>;
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  goals: Goal[];
  addGoal: (goal: Goal) => Promise<void>;
  updateGoal: (goalId: string, updates: Partial<Goal>) => Promise<void>;
  deleteGoal: (goalId: string) => Promise<void>;
  assets: MarketingAsset[];
  addAsset: (asset: MarketingAsset) => Promise<void>;
  deleteAsset: (assetId: string) => Promise<void>;
  resolutions: BoardResolution[];
  addResolution: (resolution: BoardResolution) => Promise<void>;
  updateResolution: (id: string, updates: Partial<BoardResolution>) => Promise<void>;
  deleteResolution: (id: string) => Promise<void>;
}

const CSuiteContext = createContext<CSuiteContextType | undefined>(undefined);

export function CSuiteProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [company, setCompany] = useState<CompanyContext | null>(null);
  const [companyLoading, setCompanyLoading] = useState(true);
  const [team, setTeam] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [assets, setAssets] = useState<MarketingAsset[]>([]);
  const [resolutions, setResolutions] = useState<BoardResolution[]>([]);

  // 1. Auth initialization
  useEffect(() => {
    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
    } else {
      // Default initial session user
      const defaultUser: AuthUser = {
        uid: 'user_default_123',
        email: 'founder@example.com',
        displayName: 'Founder',
        photoURL: 'https://picsum.photos/seed/founder/200'
      };
      setUser(defaultUser);
    }
    setAuthReady(true);
  }, []);

  // Fetch company data for logged in user
  const fetchCompany = useCallback(async () => {
    if (!user) {
      setCompany(null);
      setCompanyLoading(false);
      return;
    }
    try {
      const data = await apiFetch<{ companies: CompanyContext[] }>(`/api/companies?ownerId=${user.uid}`);
      if (data.companies && data.companies.length > 0) {
        setCompany(data.companies[0]);
      } else {
        setCompany(null);
      }
    } catch (e) {
      console.error("Failed to fetch company", e);
      setCompany(null);
    } finally {
      setCompanyLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authReady) {
      fetchCompany();
    }
  }, [authReady, fetchCompany]);

  // Fetch sub-entities when company changes
  const fetchCompanyEntities = useCallback(async () => {
    if (!company?.id) {
      setTeam([]);
      setMessages([]);
      setTasks([]);
      setGoals([]);
      setAssets([]);
      return;
    }

    try {
      const [agentsData, msgData, taskData, goalData, assetData, resData] = await Promise.all([
        apiFetch<{ agents: Agent[] }>(`/api/companies/${company.id}/agents`),
        apiFetch<{ messages: Message[] }>(`/api/companies/${company.id}/messages`),
        apiFetch<{ tasks: Task[] }>(`/api/companies/${company.id}/tasks`),
        apiFetch<{ goals: Goal[] }>(`/api/companies/${company.id}/goals`),
        apiFetch<{ assets: MarketingAsset[] }>(`/api/companies/${company.id}/assets`),
        apiFetch<{ resolutions: BoardResolution[] }>(`/api/companies/${company.id}/resolutions`)
      ]);

      setTeam(agentsData.agents || []);
      setMessages(msgData.messages || []);
      setTasks(taskData.tasks || []);
      setGoals(goalData.goals || []);
      setAssets(assetData.assets || []);
      setResolutions(resData.resolutions || []);
    } catch (e) {
      console.error("Failed to fetch company entities", e);
    }
  }, [company?.id]);

  useEffect(() => {
    fetchCompanyEntities();
  }, [fetchCompanyEntities]);

  // Real-time WebSocket synchronization
  useEffect(() => {
    if (!company?.id) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/frontend/stream`;
    
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'company_updated') {
            fetchCompany();
          } else if (data.type === 'agents_updated' || data.type === 'messages_updated' || data.type === 'tasks_updated' || data.type === 'goals_updated' || data.type === 'assets_updated' || data.type === 'resolutions_updated') {
            fetchCompanyEntities();
          }
        } catch (e) {
          // Ignore non-JSON messages
        }
      };
    } catch (e) {
      console.warn("WebSocket listener connection failed:", e);
    }

    return () => {
      if (ws) ws.close();
    };
  }, [company?.id, fetchCompany, fetchCompanyEntities]);

  // Mutators calling PostgreSQL REST API
  const updateCompany = async (updates: Partial<CompanyContext>) => {
    if (!company?.id) return;
    try {
      const data = await apiFetch<{ company: CompanyContext }>(`/api/companies/${company.id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      setCompany(data.company);
    } catch (error) {
      console.error("Error updating company:", error);
      throw error;
    }
  };

  const updateAgent = async (agentId: string, updates: Partial<Agent>) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      setTeam(prev => prev.map(a => a.id === agentId ? { ...a, ...updates } : a));
    } catch (error) {
      console.error("Error updating agent:", error);
      throw error;
    }
  };

  const addMessage = async (message: Message) => {
    if (!company?.id) return;
    try {
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });

      await apiFetch(`/api/companies/${company.id}/messages`, {
        method: 'POST',
        body: JSON.stringify(message)
      });
    } catch (error) {
      console.error("Error adding message:", error);
    }
  };

  const updateMessage = async (messageId: string, updates: Partial<Message>) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, ...updates } : m));
    } catch (error) {
      console.error("Error updating message:", error);
      throw error;
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const addTask = async (task: Task) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/companies/${company.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify(task)
      });
      setTasks(prev => [task, ...prev]);
    } catch (error) {
      console.error("Error adding task:", error);
      throw error;
    }
  };

  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
    } catch (error) {
      console.error("Error updating task:", error);
      throw error;
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: 'DELETE'
      });
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (error) {
      console.error("Error deleting task:", error);
      throw error;
    }
  };

  const addGoal = async (goal: Goal) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/companies/${company.id}/goals`, {
        method: 'POST',
        body: JSON.stringify(goal)
      });
      setGoals(prev => [goal, ...prev]);
    } catch (error) {
      console.error("Error adding goal:", error);
      throw error;
    }
  };

  const updateGoal = async (goalId: string, updates: Partial<Goal>) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/goals/${goalId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      setGoals(prev => prev.map(g => g.id === goalId ? { ...g, ...updates } : g));
    } catch (error) {
      console.error("Error updating goal:", error);
      throw error;
    }
  };

  const deleteGoal = async (goalId: string) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/goals/${goalId}`, {
        method: 'DELETE'
      });
      setGoals(prev => prev.filter(g => g.id !== goalId));
    } catch (error) {
      console.error("Error deleting goal:", error);
      throw error;
    }
  };

  const addAsset = async (asset: MarketingAsset) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/companies/${company.id}/assets`, {
        method: 'POST',
        body: JSON.stringify(asset)
      });
      setAssets(prev => [asset, ...prev]);
    } catch (error) {
      console.error("Error adding asset:", error);
      throw error;
    }
  };

  const deleteAsset = async (assetId: string) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/assets/${assetId}`, {
        method: 'DELETE'
      });
      setAssets(prev => prev.filter(a => a.id !== assetId));
    } catch (error) {
      console.error("Error deleting asset:", error);
      throw error;
    }
  };

  const addResolution = async (resolution: BoardResolution) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/companies/${company.id}/resolutions`, {
        method: 'POST',
        body: JSON.stringify(resolution)
      });
      setResolutions(prev => [resolution, ...prev]);
    } catch (error) {
      console.error("Error adding resolution:", error);
      throw error;
    }
  };

  const updateResolution = async (id: string, updates: Partial<BoardResolution>) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/resolutions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      setResolutions(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    } catch (error) {
      console.error("Error updating resolution:", error);
      throw error;
    }
  };

  const deleteResolution = async (id: string) => {
    if (!company?.id) return;
    try {
      await apiFetch(`/api/resolutions/${id}`, {
        method: 'DELETE'
      });
      setResolutions(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      console.error("Error deleting resolution:", error);
      throw error;
    }
  };

  return (
    <CSuiteContext.Provider value={{ 
      user, authReady, company, companyLoading, setCompany, updateCompany, 
      team, setTeam, updateAgent, 
      messages, addMessage, updateMessage, clearMessages,
      tasks, addTask, updateTask, deleteTask,
      goals, addGoal, updateGoal, deleteGoal,
      assets, addAsset, deleteAsset,
      resolutions, addResolution, updateResolution, deleteResolution
    }}>
      {children}
    </CSuiteContext.Provider>
  );
}

export function useCSuite() {
  const context = useContext(CSuiteContext);
  if (context === undefined) {
    throw new Error('useCSuite must be used within a CSuiteProvider');
  }
  return context;
}
