import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Riplo Arena',
  description: 'Riplo Evals Battleground',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
