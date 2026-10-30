import { redirect } from "next/navigation";

// Shelves are browsed on the home page now; keep old links working.
export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/?shelf=${encodeURIComponent(id)}`);
}
