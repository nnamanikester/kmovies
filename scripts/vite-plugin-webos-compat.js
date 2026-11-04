/**
 * Vite emits `<script type="module" crossorigin>` tags. Under webOS's file://
 * origin those fail (CORS) and older TV engines don't support ES modules.
 * This plugin rewrites the built HTML to use a plain, deferred classic script.
 */
export default function webosCompat() {
  return {
    name: 'webos-compat',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin/g, '<script defer')
        .replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"');
    },
  };
}
