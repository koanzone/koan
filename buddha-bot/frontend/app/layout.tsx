import type { Metadata, Viewport } from 'next';
import './style.css';
export const metadata: Metadata = { title: 'Buddha Bot', description: 'A little space to look closer.', appleWebApp: { capable: true, statusBarStyle: 'black-translucent' }, icons: { apple: '/icons/icon-192.png' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b0a0e', viewportFit: 'cover' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
