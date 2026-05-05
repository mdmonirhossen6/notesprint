import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { TopNav } from "@/components/layout/TopNav";
import { TelegramPopup } from "@/components/shared/TelegramPopup";
import { ThemeProvider } from "@/components/shared/ThemeProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NoteSprint",
  description: "Convert handwritten or scanned study notes into clean, printable PDFs. Free forever.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen antialiased bg-background text-foreground`}>
        <ThemeProvider>
          <div className="flex min-h-screen">
            <Sidebar />
          <main className="flex-1 flex flex-col min-h-screen w-full relative">
            <TopNav />
            <div className="flex-1 pb-16 md:pb-0 overflow-y-auto">
              <div className="max-w-md mx-auto md:max-w-4xl w-full p-4 md:p-8">
                {children}
              </div>
            </div>
            <MobileNav />
            <TelegramPopup />
          </main>
        </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
