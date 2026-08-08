"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Polls the current route every 4s so the order book / tape stay live
// without the viewer needing to reload. Renders nothing.
export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
