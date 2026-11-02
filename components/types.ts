export type Item = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  kind: string;
  position?: number;
  duration?: number;
};

export type SessionUser = {
  id: number;
  username: string;
  role: "admin" | "user";
  canUpload: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
};
