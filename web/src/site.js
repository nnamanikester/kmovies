/** The readable name of a site, like example.com. */
export function siteName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
