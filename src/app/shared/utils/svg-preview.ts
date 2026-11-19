export function safeSvgPreview(svg: string): string {
  try {
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') return '<span class="bad-svg">!</span>';
    document.querySelectorAll('script,style,link,foreignObject,iframe,object,embed,audio,video').forEach(node => node.remove());
    document.querySelectorAll('*').forEach(element => {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const unsafeReference = (name === 'href' || name === 'xlink:href') && !attribute.value.startsWith('#');
        if (name.startsWith('on') || unsafeReference || /javascript:|url\s*\(\s*["']?(?!#)/i.test(attribute.value)) {
          element.removeAttribute(attribute.name);
        }
      }
    });
    document.documentElement.removeAttribute('width');
    document.documentElement.removeAttribute('height');
    return new XMLSerializer().serializeToString(document.documentElement);
  } catch {
    return '<span class="bad-svg">!</span>';
  }
}
