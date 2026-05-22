import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RAG dla dokumentów',
  description: 'Indeksuj dokumenty i odpytuj je przy użyciu modelu językowego.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
