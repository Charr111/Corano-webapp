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
