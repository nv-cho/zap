import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Zap - Be fast', description: 'Turn your company knowledge into a proposal you can stand behind.' };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}
