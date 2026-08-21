import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RAG for Documents',
  description: 'Index documents and query them using a language model.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
