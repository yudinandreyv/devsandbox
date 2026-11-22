import React, { useEffect } from 'react';
import { useI18n } from '../context/I18nContext';

interface SeoHeadProps {
  title: string;
  description: string;
  canonicalPath?: string;
}

export const SeoHead: React.FC<SeoHeadProps> = ({ title, description, canonicalPath }) => {
  const { currentPath } = useI18n();
  const path = canonicalPath !== undefined ? canonicalPath : currentPath;
  const normalizedPath = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;

  useEffect(() => {
    // 1. Update Title
    document.title = `${title} | DevSandbox`;

    // 2. Update Meta Description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', description);

    // 3. Update Canonical link (locale is client-side only, URL stays clean)
    const baseUrl = 'https://gateaway.cloud';
    const canonicalHref = `${baseUrl}${normalizedPath || '/'}`;
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalHref);
  }, [title, description, normalizedPath]);

  return null;
};
