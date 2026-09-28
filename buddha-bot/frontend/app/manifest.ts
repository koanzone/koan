import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
 return { name: 'Buddha Bot', short_name: 'Buddha Bot', description: 'A little space to look closer.', start_url: '/', display: 'standalone', background_color: '#0b0a0e', theme_color: '#0b0a0e', icons: [192,512].map(size => ({src: `/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any'})) };
}
