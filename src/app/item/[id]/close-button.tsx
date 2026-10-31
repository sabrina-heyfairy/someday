"use client";
import { useRouter } from "next/navigation";

// Round ink button in the top-left of the detail view. Goes back to wherever the card was opened from,
// or home when the page was opened directly (shared link, new tab).
export function CloseButton() {
  const router = useRouter();
  const close = () => {
    // Client-side navigation does not update document.referrer, so history length is the only signal we have.
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/");
  };
  return (
    <button onClick={close} aria-label="Close" title="Close" className="close-x">×</button>
  );
}
