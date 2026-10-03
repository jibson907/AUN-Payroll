/**
 * Role-based access control — the single list of who may do what.
 *
 * The API enforces it with requirePermission() on every route, and the same
 * list is sent to the browser (login / /auth/me) so the UI hides exactly the
 * actions the server would refuse. Hiding in the UI is a convenience only;
 * the server check is what protects the data.
 */
const ADMIN = 'admin';
const OFFICER = 'payroll_officer';
const VIEWER = 'viewer';
const ALL = [ADMIN, OFFICER, VIEWER];

const PERMISSIONS = {
  // read-only — every signed-in role
  'dashboard.view': ALL,
  'payroll.view': ALL, // runs, employee records, search
  'payslip.download': ALL, // PDF preview / download
  'audit.view': ALL,

  // normal payroll processing — admin + payroll officer
  'payroll.upload': [ADMIN, OFFICER],
  'payroll.generate': [ADMIN, OFFICER],
  'payroll.send': [ADMIN, OFFICER], // send, retry failed, send one

  // corrections and destructive actions — admin only
  'payroll.edit': [ADMIN],
  'payroll.delete': [ADMIN],

  // administration — admin only
  'users.manage': [ADMIN], // list, add, edit, change role, reset password, delete
  'settings.email': [ADMIN],
};

const can = (role, permission) => (PERMISSIONS[permission] || []).includes(role);
const permissionsFor = (role) => Object.keys(PERMISSIONS).filter((p) => can(role, p));

module.exports = {
  PERMISSIONS, can, permissionsFor, ROLES: ALL,
};
