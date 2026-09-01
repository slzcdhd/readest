import { describe, it, expect } from 'vitest';
import { extractSectionText, isImageOnlySection } from '@/services/reedy/wiki/extractText';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('extractText — extractSectionText', () => {
  it('concatenates visible text from the body', () => {
    const doc = docFrom('<html><body><p>Hello</p><p>world</p></body></html>');
    expect(extractSectionText(doc)).toBe('Helloworld');
  });

  it('skips script/style/noscript/template', () => {
    const doc = docFrom(
      '<html><body><p>keep</p><script>drop me</script><style>.x{}</style><noscript>no</noscript><template>t</template><p>tail</p></body></html>',
    );
    expect(extractSectionText(doc)).toBe('keeptail');
  });

  it('skips nodes under a .cfi-inert ancestor', () => {
    const doc = docFrom(
      '<html><body><p>keep</p><div class="cfi-inert"><p>drop</p></div></body></html>',
    );
    expect(extractSectionText(doc)).toBe('keep');
  });

  it('returns empty string for a bodyless document', () => {
    const doc = docFrom('<html><head></head></html>');
    expect(extractSectionText(doc)).toBe('');
  });
});

describe('extractText — isImageOnlySection', () => {
  it('detects whitespace-only text', () => {
    expect(isImageOnlySection('   \n\t ')).toBe(true);
    expect(isImageOnlySection('real text')).toBe(false);
  });
});
