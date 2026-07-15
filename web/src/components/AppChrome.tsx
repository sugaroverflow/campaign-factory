"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const operationsRoute = pathname === "/operations" || pathname.startsWith("/operations/");

  if (operationsRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <SiteNav />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </>
  );
}
