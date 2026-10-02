### Task 2: Alihkan `resolveStoryCover` queries.ts ke modul baru

**Files:**
- Modify: `lib/api/queries.ts:29-38`

**Interfaces:**
- Consumes: `resolveStoryCover`, `DEFAULT_STORY_COVER` dari `lib/cover/url.ts` (Task 1).
- Produces: re-export `resolveStoryCover` & `DEFAULT_STORY_COVER` dari `lib/api/queries.ts` — konsumen existing (`lib/api/share.ts:124`) tidak berubah.

- [ ] **Step 1: Ganti definisi lokal dengan re-export**

Di `lib/api/queries.ts`, hapus blok lama (baris 29–38):

```ts
/** Sampul default untuk cerita tanpa cover (ringan, WebP untuk mobile). */
export const DEFAULT_STORY_COVER = '/covers/default-cover.webp'

/**
 * Legacy stories may store '/placeholder.svg' (with or without query params)
 * or null cover. Resolve ke sampul default sebelum sampai ke UI.
 */
export function resolveStoryCover(cover: string | null | undefined): string {
  return cover && !cover.startsWith('/placeholder.svg') ? cover : DEFAULT_STORY_COVER
}
```

ganti dengan:

```ts
/**
 * Sampul default + resolver URL publik kini tinggal di modul rakitan URL
 * (lib/cover/url.ts) supaya jalur tulis (putCover/apply) memakai definisi
 * yang sama persis. Re-export di sini demi konsumen existing.
 */
export { DEFAULT_STORY_COVER, resolveStoryCover } from '@/lib/cover/url'
```

dan tambahkan import internal (untuk pemakaian di `toDetail`):

```ts
import { resolveStoryCover } from '@/lib/cover/url'
```

- [ ] **Step 2: Pastikan unit test terkait tetap hijau**

Run: `pnpm exec vitest run lib/cover/url.test.ts && pnpm typecheck`
Expected: PASS; typecheck bersih (re-export valid, tidak ada duplikat nama).

- [ ] **Step 3: Commit**

```bash
git add lib/api/queries.ts
git commit -m "refactor(cover): centralize cover URL resolution in lib/cover/url"
```

---

