import type { Metadata } from "next";
import { Inter, Merriweather } from "next/font/google";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Nav } from "@/app/_components/nav";
import { WelcomeModal } from "@/app/_components/welcome-modal";
import "./globals.css";

const heading = Merriweather({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clever Support Assistant",
  description:
    "AI-powered assistant for Clever support. Get instant answers about SSO, rostering, logins, and admin setup — grounded in the Clever help center.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable} h-full antialiased`}>
      <body className="flex h-full flex-col">
        <TooltipProvider>
          <Nav />
          {children}
          <WelcomeModal />
        </TooltipProvider>
      </body>
    </html>
  );
}
