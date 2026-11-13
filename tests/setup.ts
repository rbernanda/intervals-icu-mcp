import { vi } from 'vitest';
// Mirror the wrangler.jsonc capability flag; the runtime check independently verifies it in workerd.
vi.stubGlobal('Cloudflare', { compatibilityFlags: { global_fetch_strictly_public: true } });
