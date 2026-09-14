export type MenuCategory = {
  id: string;
  name: string;
  order: number;
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
