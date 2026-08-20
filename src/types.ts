export interface CompanyContext {
  id: string;
  ownerId: string;
  name: string;
  industry: string;
  category: string;
  description: string;
  createdAt: string;
  integrations?: {
    hubspotApiKey?: string;
    africasTalkingApiKey?: string;
    africasTalkingUsername?: string;
    africasTalkingVirtualNumber?: string;
    zohoEmail?: string;
    zohoPassword?: string;
  };
}

export interface Agent {
  id: string;
  companyId: string;
  role: string;
  name: string;
  bio: string;
  expertise: string[];
  avatarUrl: string;
  createdAt: string;
}

export interface Proposal {
  id: string;
  type: 'task' | 'goal';
  title: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface MarketingAsset {
  id: string;
  companyId: string;
  name: string;
  content: string;
  createdAt: number;
}

export interface Message {
  id: string;
  companyId: string;
  senderId: string; // 'user' or agent.id
  text: string;
  timestamp: number;
  fileName?: string;
  fileContent?: string;
  proposals?: Proposal[];
}

export interface Task {
  id: string;
  companyId: string;
  assignedTo: string;
  title: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  createdAt: number;
}

export interface SmartGoal {
  text: string;
  completed: boolean;
}

export interface KPI {
  text: string;
  met: boolean;
}

export interface Goal {
  id: string;
  companyId: string;
  objective: string;
  smartGoals: SmartGoal[] | string[]; // Support legacy string arrays
  kpis: KPI[] | string[]; // Support legacy string arrays
  createdAt: number;
}

export interface AppState {
  company: CompanyContext | null;
  team: Agent[];
  messages: Message[];
}

export interface ResolutionVote {
  agentId: string;
  agentName: string;
  agentRole: string;
  vote: 'In Favor' | 'Against' | 'Abstain';
  comment?: string;
}

export interface BoardResolution {
  id: string;
  companyId: string;
  resolutionNumber: string;
  title: string;
  category: 'Strategic' | 'Financial' | 'Governance' | 'Operational' | 'HR & Compensation';
  content: string;
  proposedBy: string;
  status: 'Draft' | 'Passed' | 'Rejected';
  votes: ResolutionVote[];
  passedAt?: number;
  createdAt: number;
}
