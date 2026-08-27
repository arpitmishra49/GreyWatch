import type { Metadata } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth";
import { NavLinks } from "./NavLinks";
import { LogoutButton } from "./LogoutButton";

export const metadata: Metadata = {
  title: "GreyWatch",
  description: "Threshold monitoring for Grafana panels, delivered as Slack alerts.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="nav-left">
            <span className="nav-brand">
              GreyWatch<span className="mark">.</span>
            </span>
            {user && <NavLinks />}
          </div>
          <div className="nav-right">
            {user ? (
              <>
                <span className="username">{user.username}</span>
                <LogoutButton />
              </>
            ) : (
              <a className="nav-link" href="/login">
                Log in
              </a>
            )}
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
