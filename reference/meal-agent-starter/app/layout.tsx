import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Meal Agent — Smart Meal Planning',
  description: 'GF, sugar-free meal planning with Pinterest import, deal scanning, and dietary compliance.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Fraunces:wght@400;700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, background: '#0e0e0e', color: '#e8e8e8' }}>
        {children}
      </body>
    </html>
  );
}
