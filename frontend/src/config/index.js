/**
 * Central frontend configuration.
 * The API is same-origin (<base>/api) in development (Vite proxy) and
 * production (served by the backend). VITE_API_URL can override it if ever needed.
 */

// Path the app is published under, from BASE_PATH at build time:
// '' at the root of a domain, '/payrol' for https://aun.edu.ng/payrol.
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, '');

export const API_URL = import.meta.env.VITE_API_URL || `${BASE_PATH}/api`;

// Full browser path of the sign-in page (for hard redirects outside the router).
export const LOGIN_PATH = `${BASE_PATH}/login`;

// Legacy localStorage key — only used to delete tokens stored by old versions.
// Sessions now live in an HttpOnly cookie.
export const TOKEN_KEY = 'aun_payroll_token';
