import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TrendLens AI — Ugandan Food Business Analytics',
  description: 'Social media trend analytics platform for Ugandan food businesses',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-sky-50 text-slate-800">
        {children}
      </body>
    </html>
  );
}
