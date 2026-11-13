const BASE = process.env.FAKE_SLACK_URL;
export const LogLevel = { ERROR: "error" };
async function call(token, method, args) {
  const res = await fetch(`${BASE}/slack/${method}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(args, (k, v) => (Buffer.isBuffer(v) || v?.type === "Buffer" ? `<${v.length ?? v.data?.length} bytes>` : v)) });
  const data = await res.json();
  if (!data.ok) throw Object.assign(new Error(data.error), { data });
  return data;
}
export class WebClient {
  constructor(token) {
    const group = (name) => new Proxy({}, { get: (_, m) => (args = {}) => call(token, `${name}.${m}`, args) });
    for (const g of ["auth", "bots", "chat", "reactions", "users", "files"]) this[g] = group(g);
    this.filesUploadV2 = (args) => call(token, "filesUploadV2", { ...args, file: `<${args.file.length} bytes>` });
  }
}
