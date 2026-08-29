"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Sites" },
  { href: "/tasks", label: "All Tasks" },
  { href: "/insights", label: "Insights" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <div className="nav-links">
      {LINKS.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link key={link.href} className={`nav-link${active ? " active" : ""}`} href={link.href}>
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
