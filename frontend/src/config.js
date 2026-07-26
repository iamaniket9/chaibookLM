/** Backend API base URL — used when the app is deployed (not behind Vite proxy). */
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "https://chaibooklm.onrender.com";
