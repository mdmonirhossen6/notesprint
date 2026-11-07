export type AccessRole = 'super_admin';

export function getAccessRole(tgId: number, superAdminId: number): AccessRole | null {
  return tgId === superAdminId ? 'super_admin' : null;
}

export function isSuperAdmin(tgId: number, superAdminId: number): boolean {
  return getAccessRole(tgId, superAdminId) !== null;
}
