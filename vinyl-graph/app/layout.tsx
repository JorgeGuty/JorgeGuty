import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Grafo de Influencias — Colección de Vinilos',
  description: 'Grafo dirigido de influencias musicales entre los discos de tu colección de vinilos.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
