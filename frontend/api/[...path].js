/**
 * Vercel Serverless Function — API Proxy to Render backend.
 *
 * Catches every request to /api/* and forwards it raw to the Render backend.
 * This is more reliable than vercel.json rewrites for Vite projects,
 * because Vercel's Vite preset sometimes ignores external-destination rewrites.
 */
const BACKEND = "https://chaibooklm.onrender.com";

// Disable Vercel's automatic body parsing so we can forward the raw body
// (needed for multipart file uploads and SSE streaming)
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const { path } = req.query; // array of path segments after /api/
  const apiPath = Array.isArray(path) ? path.join("/") : path || "";

  // Reconstruct query string (excluding the catch-all path param itself)
  const cleanParams = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== "path") cleanParams.append(k, v);
  }
  const qs = cleanParams.toString();
  const targetUrl = `${BACKEND}/api/${apiPath}${qs ? "?" + qs : ""}`;

  try {
    // Build headers to forward (skip hop-by-hop & host headers)
    const forwardHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!["host", "connection", "content-length", "transfer-encoding"].includes(k.toLowerCase())) {
        forwardHeaders[k] = v;
      }
    }

    // Read raw request body (works for JSON, multipart, and empty bodies)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);

    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
    };
    if (rawBody.length > 0) {
      fetchOptions.body = rawBody;
    }

    const backendRes = await fetch(targetUrl, fetchOptions);

    // Forward status & response headers
    res.status(backendRes.status);
    for (const [k, v] of backendRes.headers.entries()) {
      if (!["content-encoding", "transfer-encoding"].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    }

    // Stream the body — works for JSON, HTML, and SSE chat streams
    const body = await backendRes.text();
    res.send(body);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(502).json({ error: "Backend unreachable", detail: err.message });
  }
}
