export function authorized(req: Request): boolean {
  const token = process.env.CAPTURE_TOKEN;
  if (!token) return false;
  const h = req.headers.get("authorization") ?? "";
  const q = new URL(req.url).searchParams.get("token");
  return h === `Bearer ${token}` || q === token;
}
