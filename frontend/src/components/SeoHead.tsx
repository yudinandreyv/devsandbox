import React, { useEffect } from 'react';
import { useI18n } from '../context/I18nContext';

interface SeoHeadProps {
  title: string;
  description: string;
  canonicalPath?: string;
}

export const SeoHead: React.FC<SeoHeadProps> = ({ title, description, canonicalPath }) => {
  const { locale, currentPath } = useI18n();
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

    // 3. Update Canonical link
    const baseUrl = 'https://sandbox.gateaway.cloud';
    const canonicalHref = `${baseUrl}/${locale}${normalizedPath}`;
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalHref);

    // 4. Update or ensure alternate hreflang tags
    const hreflangs: { lang: string; href: string }[] = [
      { lang: 'en', href: `${baseUrl}/en${normalizedPath}` },
      { lang: 'ru', href: `${baseUrl}/ru${normalizedPath}` },
      { lang: 'x-default', href: `${baseUrl}/en${normalizedPath}` },
    ];

    hreflangs.forEach(({ lang, href }) => {
      let link = document.head.querySelector(`link[rel="alternate"][hreflang="${lang}"]`);
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'alternate');
        link.setAttribute('hreflang', lang);
        document.head.appendChild(link);
      }
      link.setAttribute('href', href);
    });
  }, [title, description, locale, normalizedPath]);

  return null;
};
