export type Role = 'ho' | 'site' | 'mgmt' | 'project_manager';

export interface User {
  id: string;
  name: string;
  role: Role;
  site: string | null;        // primary/first site (= sites[0]) — kept for compat
  sites: string[];            // all sites the user is assigned to
  title: string | null;
}

export interface LoginResponse {
  token: string;
  user: User;
}
