export type Role = 'ho' | 'site' | 'mgmt';

export interface User {
  id: string;
  name: string;
  role: Role;
  // Sites the user owns. HO/MD usually have []; site role has ≥1 entry.
  sites: string[];
  title: string | null;
}

export interface LoginResponse {
  token: string;
  user: User;
}
