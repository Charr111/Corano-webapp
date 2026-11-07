export type MenuCategory = {
  id: string;
  name: string;
  order: number;
  description?: string;
};

export type MenuItem = {
  id: string;
  category: string;
  title: string;
  price: string;
  desc: string;
  img: string;
  available?: boolean;
  addons?: string[];
  order?: number;
  isNew?: boolean;
  popular?: boolean;
};

export type Review = {
  id: string;
  author: string;
  text: string;
  rating: number;
  date: string;
  status?: 'pending' | 'approved' | 'rejected';
};

export type AdminUser = {
  id: string;
  email: string;
  addedBy?: string;
  createdAt?: string;
};

export type StoreSettings = {
  currency: 'USD' | 'LBP';
  exchangeRate: number;
  aiEnabled?: boolean;
};

export type StoreDataPayload = {
  version: number;
  updatedAt: string;
  settings: StoreSettings;
  categories: MenuCategory[];
  items: MenuItem[];
  reviews: Review[];
  admins: AdminUser[];
};

export type AiChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  recommendedItemIds?: string[];
  timestamp: string;
};

export type AiConversationSession = {
  id: string;
  guestName?: string;
  createdAt: string;
  updatedAt: string;
  language: 'English' | 'Lebanese' | 'Arabic';
  topicTag: string;
  summary: string;
  messages: AiChatMessage[];
};

