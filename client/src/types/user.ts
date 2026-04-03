export type Role = 'ho' | 'site' | 'mgmt';

export interface User {
  id: string;
  name: string;
  role: Role;
  site: string | null;
  title: string | null;
}

export interface LoginResponse {
  token: string;
  user: User;
}
