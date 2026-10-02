### Task 4: Jalur tulis & baca konsumen mengikuti kontrak key

**Files:**
- Modify: `lib/cover/server.ts:93-103` (`setStoryCover`) dan `:136-164` (`getStoryCoverCandidates`)
- Modify: `app/api/stories/[id]/cover/generate/route.ts:148,168-171,175`
- Modify: `app/api/stories/[id]/cover/upload/route.ts:85-95`
- Modify: `app/api/stories/[id]/cover/apply/route.ts:31-46`

**Interfaces:**
- Consumes: `putCover` → `{ ok: true; key }` (Task 3); `resolveStoryCover`, `coverKeyFromPublicUrl` dari `lib/cover/url.ts` (Task 1).
- Produces: `setStoryCover(storyId, userId, coverPath)` menerima key ATAU URL publik (dinormalisasi ke key); `getStoryCoverCandidates()` mengembalikan `url` yang SUDAH di-resolve (UI tetap memperlakukan sebagai URL final).

- [ ] **Step 1: Ubah `lib/cover/server.ts`**

Di `setStoryCover` (ganti fungsi, baris 92–103):

```ts
import { coverKeyFromPublicUrl, resolveStoryCover } from '@/lib/cover/url'
```

```ts
/**
 * Pasang sampul baru; penjaga pemilik diulang di klausa update.
 * Input bisa object key (dari putCover) atau URL publik (dari kandidat);
 * URL milik base publik kita dinormalisasi kembali menjadi key supaya
 * stories.cover selalu konsisten menyimpan key.
 */
export async function setStoryCover(storyId: string, userId: string, coverPath: string): Promise<boolean> {
  const db = createAdminClient()
  const cover = coverKeyFromPublicUrl(coverPath) ?? coverPath
  const { error, count } = await db
    .from('stories')
    .update({ cover }, { count: 'exact' })
    .eq('id', storyId)
    .eq('owner_user_id', userId)

  if (error) throw new Error(`setStoryCover: ${error.message}`)
  return (count ?? 0) > 0
}
```

Di `getStoryCoverCandidates` (baris 153–159), ubah mapping agar `url` yang sampai ke UI sudah absolut:

```ts
    return data.map((r) => ({
      id: String(r.id),
      url: resolveStoryCover(String(r.url)),
      preset: String(r.preset),
      createdAt: String(r.created_at),
      expiresAt: String(r.expires_at),
    }))
```

(Di DB, kandidat kini menyimpan key; resolver merakit URL saat baca.)

- [ ] **Step 2: Ubah route `cover/generate`**

- Baris 148: `const applied = await setStoryCover(storyId, user.id, stored.key)`
- Baris 168–171: `await recordStoryCoverCandidate(storyId, user.id, { url: stored.key, preset: options.preset })`
- Baris 175: `return NextResponse.json({ ok: true, cover: resolveStoryCover(stored.key), balance })`
- Tambah import: `import { resolveStoryCover } from '@/lib/cover/url'`

- [ ] **Step 3: Ubah route `cover/upload`**

- Baris 85: `const applied = await setStoryCover(storyId, user.id, stored.key)`
- Baris 90–93: `await recordStoryCoverCandidate(storyId, user.id, { url: stored.key, preset: 'unggah' })`
- Baris 95: `return NextResponse.json({ ok: true, cover: resolveStoryCover(stored.key) })`
- Tambah import: `import { resolveStoryCover } from '@/lib/cover/url'`

- [ ] **Step 4: Ubah route `cover/apply`**

Ganti blok validasi–pasang (baris 31–46):

```ts
  const body = await req.json().catch(() => ({}))
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (!url) {
    return NextResponse.json({ ok: false, error: 'URL sampul tidak valid.' }, { status: 400 })
  }

  const applied = await setStoryCover(storyId, user.id, url)
  if (!applied) {
    return NextResponse.json({ ok: false, error: 'Sampul gagal dipasang.' }, { status: 500 })
  }

  // setStoryCover menormalisasi URL base-publik ke key; respons memakai
  // resolver supaya UI selalu menerima URL yang bisa dirender.
  return NextResponse.json({ ok: true, cover: resolveStoryCover(coverKeyFromPublicUrl(url) ?? url) })
```

Tambah import: `import { coverKeyFromPublicUrl, resolveStoryCover } from '@/lib/cover/url'`

- [ ] **Step 5: Gate statis**

Run: `pnpm typecheck && pnpm lint`
Expected: bersih. (`grep -rn "stored.url" app/api/stories/` harus kosong.)

- [ ] **Step 6: Commit**

```bash
git add lib/cover/server.ts app/api/stories/\[id\]/cover/generate/route.ts app/api/stories/\[id\]/cover/upload/route.ts app/api/stories/\[id\]/cover/apply/route.ts
git commit -m "feat(cover): store object keys across cover write paths, resolve URLs at read"
```

---

