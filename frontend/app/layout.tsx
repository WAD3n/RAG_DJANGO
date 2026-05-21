import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RAGFLOW — ask your documents anything',
  description: 'Index your PDFs, decks, spreadsheets and notes. Answer questions with citations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
