// What the signed-in user may do. The list comes from the server (login /
// /auth/me, built from backend/config/permissions.js), so the UI hides exactly
// what the API would refuse. The server still checks every request.
export const can = (user, permission) => !!user?.permissions?.includes(permission);

export const ROLE_LABELS = { admin: 'Administrator', payroll_officer: 'Payroll Officer', viewer: 'Viewer' };

// Must match MIN_LENGTH in backend/utils/password.js
export const MIN_PASSWORD = 6;
