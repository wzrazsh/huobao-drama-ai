# Storyboard ttsSegments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Storyboard.ttsSegments` JSON field so multi-speaker storyboards (like #11 陆辰/林夕) can be dubbed with per-segment voiceIds, while keeping the single-voiceId path fully backward compatible.

**Architecture:** New optional `ttsSegments` field. If present, `POST /api/ai/generate-tts` runs TTS once per segment, saves per-segment mp3 files, then ffmpeg-concats them into `ttsAudioUrl`. Single-voiceId path untouched. #11 is rewritten as the canonical example.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, existing `ffmpeg.ts` helpers, existing `aiClient.generateTts`.

---

## File Structure

| File | Role |
|---|---|
| `prisma/schema.prisma` | Add `ttsSegments String?` |
| `prisma/db/custom.db` | DB schema applied via prisma db push |
| `src/app/api/migrate/route.ts` | Whitelist `ttsSegments` for runtime migration |
| `src/lib/ffmpeg.ts` | Add `concatAudioSegments(segPaths: string[]): Promise<string>` |
| `src/app/api/ai/generate-tts/route.ts` | Add multi-segment path; fall through to single if no segments |
| `src/lib/api.ts` | `generateTts` accepts optional `segments` array |
| `src/lib/voice-catalog.ts` | (no change — already exports voices by speaker lookup) |
| `src/components/episode/dubbing-panel.tsx` | Per-segment audio player + regenerate button + "N 段" badge |
| `src/components/episode-workspace.tsx` | `handleGenerateTts` / `handleGenerateAllTts` pass segments |
| `src/components/episode/compose-panel.tsx` | Subtitle shows concatenated dialogue from segments |
| `src/components/episode/production-panel.tsx` | Same subtitle fix |
| `scripts/fix-storyboard-11.ts` | One-shot script: rewrite #11 with ttsSegments |
| `src/lib/types.ts` (or wherever `Storyboard` is exported) | Add `ttsSegments?: DialogueSegment[]` to TS type |

---

## Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma:165-195`
- Modify: `prisma/db/custom.db` (via `npx prisma db push`)

- [ ] **Step 1: Add field to schema**

In `prisma/schema.prisma` after `ttsAudioUrl String?` (line 184), add:
```prisma
  ttsSegments String? // JSON: DialogueSegment[] = [{speaker, text, voiceId, voiceName, audioUrl?, startMs?, endMs?, status}]
```

- [ ] **Step 2: Push schema to DB**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your schema."

- [ ] **Step 3: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client (5.x.x)"

- [ ] **Step 4: Verify column exists**

Run:
```bash
sqlite3 prisma/db/custom.db "PRAGMA table_info(Storyboard);" | grep ttsSegments
```
Expected: a row with `ttsSegments|TEXT|0||0`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add Storyboard.ttsSegments JSON field"
```

---

## Task 2: Whitelist field in runtime migrate route

**Files:**
- Modify: `src/app/api/migrate/route.ts:17-19` (find the Storyboard field whitelist)

- [ ] **Step 1: Locate whitelist**

Read `src/app/api/migrate/route.ts` and find where Storyboard updatable fields are listed. (From earlier search, it's around line 17-19 inside `storyboards/[id]/route.ts` — that's the PATCH endpoint, **not** the migrate route. The migrate route is for additive schema migrations. The PATCH endpoint whitelist is the one to update.)

- [ ] **Step 2: Add ttsSegments to allowed list**

In `src/app/api/storyboards/[id]/route.ts` around line 17-19, add `'ttsSegments'` to the allowedFields array. Also add to the data extraction loop.

- [ ] **Step 3: Verify**

Restart dev server, then verify with curl:
```bash
curl -X PATCH http://localhost:3000/api/storyboards/SOME_ID \
  -H "Content-Type: application/json" \
  -d '{"ttsSegments":"[{\"speaker\":\"test\"}]"}'
```
Expected: 200 OK with updated storyboard, no "ttsSegments" in error message.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/storyboards/[id]/route.ts
git commit -m "feat(api): allow Storyboard.ttsSegments in PATCH endpoint"
```

---

## Task 3: ffmpeg concat helper

**Files:**
- Modify: `src/lib/ffmpeg.ts` (append new function after `mergeShots` around line 372)

- [ ] **Step 1: Add `concatAudioSegments` function**

```typescript
/**
 * Concatenate multiple audio files (mp3) into a single mp3.
 * Returns the absolute path to the output file.
 * Uses ffmpeg's concat filter (re-encodes, so handles mismatched sample rates).
 */
export async function concatAudioSegments(
  segmentPaths: string[],
  outputPath?: string
): Promise<string> {
  if (segmentPaths.length === 0) {
    throw new Error('concatAudioSegments: no input segments')
  }
  if (segmentPaths.length === 1) {
    // Single segment — just copy to output
    const out = outputPath || path.join(PATHS.audio, `concat_${Date.now()}.mp3`)
    await fs.copyFile(segmentPaths[0], out)
    return out
  }

  const out = outputPath || path.join(PATHS.audio, `concat_${Date.now()}.mp3`)
  await fs.mkdir(path.dirname(out), { recursive: true })

  // Build -i args
  const inputArgs: string[] = []
  for (const p of segmentPaths) {
    inputArgs.push('-i', p)
  }

  // Build filter: [0:a][1:a]...[N-1:a]concat=n=N:v=0:a=1[out]
  const inputLabels = segmentPaths.map((_, i) => `[${i}:a]`).join('')
  const filter = `${inputLabels}concat=n=${segmentPaths.length}:v=0:a=1[out]`

  const args = [
    '-y',
    ...inputArgs,
    '-filter_complex', filter,
    '-map', '[out]',
    '-c:a', 'libmp3lame',
    '-q:a', '2',
    out,
  ]

  const result = await runFFmpeg(args)
  if (result.code !== 0) {
    throw new Error(`ffmpeg concat failed (code ${result.code}): ${result.stderr.slice(0, 500)}`)
  }
  return out
}
```

- [ ] **Step 2: Manual test**

Create a one-off test in `tmp_test_concat.mjs`:
```javascript
import { concatAudioSegments } from './src/lib/ffmpeg.ts'
// (skip — manual verification in Task 6 via generate-tts endpoint)
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ffmpeg.ts
git commit -m "feat(ffmpeg): add concatAudioSegments helper for multi-speaker TTS"
```

---

## Task 4: Multi-segment path in generate-tts API

**Files:**
- Modify: `src/app/api/ai/generate-tts/route.ts` (replace whole file body)

- [ ] **Step 1: Read current route**

Read the entire file (162 lines). Understand: it reads `{storyboardId, text, voiceId, voiceStyle}`, calls `aiClient.generateTts`, saves audio to file storage, updates storyboard with `ttsAudioUrl` and `status: 'completed'`.

- [ ] **Step 2: Refactor to support segments**

Rewrite to:
1. Accept `{storyboardId, text?, voiceId?, voiceStyle?, segments?}`.
2. If `segments` is non-empty, take multi-segment path:
   - For each segment, resolve voiceId (from input or by speaker lookup)
   - Call `aiClient.generateTts(segAudioDbId, segText, segVoiceId)` — generate one per segment
   - Save each audio file with a unique filename
   - Record duration of each via ffprobe
   - Call `concatAudioSegments` to produce merged file
   - Save merged file to file storage, get URL
   - Compute startMs/endMs from cumulative durations
   - Build `ttsSegments` JSON: `[{speaker, text, voiceId, voiceName, audioUrl, startMs, endMs, status: 'completed'}]`
   - Update storyboard: `ttsAudioUrl` = merged, `ttsSegments` = JSON, `status` = 'completed'
3. If `segments` is empty/undefined, fall through to existing single-segment logic.

- [ ] **Step 3: Add segment-level try/catch**

Wrap each per-segment TTS call in try/catch. If one segment fails:
- Mark that segment's `status: 'failed'` in the returned `ttsSegments`
- Continue with remaining segments
- If all fail: return 500
- If some fail: still concat the successful ones, return 207-style response with `partial: true, failedSegments: [...]`

- [ ] **Step 4: Verify single-segment path unchanged**

```bash
curl -X POST http://localhost:3000/api/ai/generate-tts \
  -H "Content-Type: application/json" \
  -d '{"storyboardId":"cmqav6m97005yhn0stayozq2w_EXISTING_ID","voiceId":"female-yujie"}'
```
Expected: 200, `storyboard.ttsAudioUrl` set, `ttsSegments` is null (unchanged behaviour).

- [ ] **Step 5: Verify multi-segment path**

After #11 has `ttsSegments` written, run:
```bash
curl -X POST http://localhost:3000/api/ai/generate-tts \
  -H "Content-Type: application/json" \
  -d '{"storyboardId":"<#11_ID>","segments":[{"speaker":"陆辰","text":"你是新搬来的？","voiceId":"male-qn-jingying-jingpin"},{"speaker":"林夕","text":"对，楼上，画画的。","voiceId":"female-tianmei-jingpin"}]}'
```
Expected: 200, `ttsAudioUrl` set to merged file, `ttsSegments` JSON with 2 completed entries.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ai/generate-tts/route.ts
git commit -m "feat(tts): multi-segment path with ffmpeg concat for multi-speaker storyboards"
```

---

## Task 5: api.ts — generateTts client signature

**Files:**
- Modify: `src/lib/api.ts` (find the `generateTts` function)

- [ ] **Step 1: Add segments param**

Change signature from:
```typescript
generateTts: (storyboardId: string, text: string, voiceId?: string) => Promise<...>
```
to:
```typescript
generateTts: (
  storyboardId: string,
  text: string,
  voiceId?: string,
  opts?: { segments?: Array<{ speaker: string; text: string; voiceId?: string }> }
) => Promise<...>
```

- [ ] **Step 2: Send segments in body**

When `opts.segments` is provided, include it in the request body.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(api): generateTts accepts optional segments array"
```

---

## Task 6: Fix #11 with one-shot script

**Files:**
- Create: `scripts/fix-storyboard-11.ts`

- [ ] **Step 1: Write the script**

```typescript
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  const storyboard = await db.storyboard.findFirst({
    where: {
      shotNumber: 11,
      episode: { dramaId: 'cmqahvjvx0001hnm0cx6zpc1j' },
    },
  })
  if (!storyboard) {
    console.error('#11 not found')
    return
  }

  const ttsSegments = [
    {
      speaker: '陆辰',
      text: '你是新搬来的？',
      voiceId: 'male-qn-jingying-jingpin',
      voiceName: '精英青年V2',
      status: 'pending',
    },
    {
      speaker: '林夕',
      text: '对，楼上，画画的。',
      voiceId: 'female-tianmei-jingpin',
      voiceName: '甜美女性V2',
      status: 'pending',
    },
  ]

  await db.storyboard.update({
    where: { id: storyboard.id },
    data: {
      dialogue: '你是新搬来的？/ 对，楼上，画画的。', // keep for legacy display
      ttsSegments: JSON.stringify(ttsSegments),
    },
  })
  console.log(`Updated #11 (id=${storyboard.id}) with 2 ttsSegments`)
}

main().then(() => db.$disconnect())
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/fix-storyboard-11.ts`
Expected: "Updated #11 (id=...) with 2 ttsSegments"

- [ ] **Step 3: Verify DB**

```bash
sqlite3 prisma/db/custom.db "SELECT shotNumber, dialogueChar, ttsSegments FROM Storyboard WHERE shotNumber=11;"
```
Expected: dialogueChar = "陆辰/林夕", ttsSegments = JSON with 2 entries.

- [ ] **Step 4: Commit**

```bash
git add scripts/fix-storyboard-11.ts
git commit -m "chore: rewrite #11 storyboard with 2 ttsSegments"
```

---

## Task 7: Dubbing panel — multi-segment UI

**Files:**
- Modify: `src/components/episode/dubbing-panel.tsx:142-200`

- [ ] **Step 1: Read current card structure**

Read lines 142-200 of `dubbing-panel.tsx` to understand the per-storyboard card layout. It shows: header (title + dialogueChar badge + voiceId badge), dialogue text, audio player, generate/upload buttons.

- [ ] **Step 2: Parse ttsSegments helper**

At top of file, add:
```typescript
function parseTtsSegments(storyboard: Storyboard): DialogueSegment[] | null {
  if (!storyboard.ttsSegments) return null
  try { return JSON.parse(storyboard.ttsSegments) } catch { return null }
}
```

- [ ] **Step 3: Render multi-segment card**

When `parseTtsSegments(sb)` returns non-null:
- Show "分 N 段" badge in header
- For each segment, render a sub-row with:
  - Speaker name + voiceId badge
  - Audio player if `audioUrl` exists
  - "生成此段" button if missing/failed
- Total progress: `completedSegments / totalSegments`

- [ ] **Step 4: Wire "Generate this segment" button**

When clicked, call a new variant of `api.ai.generateTts` that takes a single-segment array. The endpoint will:
- Find the existing ttsSegments
- Replace just that one segment's audio
- Re-concat all segments
- Update DB

(Easier alternative: just regenerate ALL segments and re-concat. Acceptable for v1.)

- [ ] **Step 5: Verify in UI**

Reload page. #11 should show "分 2 段" badge with two empty audio slots.

- [ ] **Step 6: Commit**

```bash
git add src/components/episode/dubbing-panel.tsx
git commit -m "feat(ui): dubbing panel supports multi-segment storyboards"
```

---

## Task 8: Subtitle rendering uses ttsSegments

**Files:**
- Modify: `src/components/episode/compose-panel.tsx:308-313, 399-407`
- Modify: `src/components/episode/production-panel.tsx:316-322, 447-455`

- [ ] **Step 1: Read both files' subtitle sections**

Both files have nearly identical subtitle display logic. They show `sb.dialogueChar + sb.dialogue`.

- [ ] **Step 2: Replace with segments-aware version**

```typescript
function getDialogueDisplay(sb: Storyboard): { speaker: string; text: string }[] {
  if (sb.ttsSegments) {
    try {
      const segs = JSON.parse(sb.ttsSegments)
      if (Array.isArray(segs) && segs.length > 0) {
        return segs.map((s: any) => ({ speaker: s.speaker, text: s.text }))
      }
    } catch {}
  }
  return [{ speaker: sb.dialogueChar || '', text: sb.dialogue || '' }]
}
```

Use it to render:
```jsx
{getDialogueDisplay(sb).map((d, i) => (
  <div key={i}>
    {d.speaker && <span className="font-medium">{d.speaker}：</span>}
    {d.text}
  </div>
))}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/episode/compose-panel.tsx src/components/episode/production-panel.tsx
git commit -m "feat(ui): subtitle display uses ttsSegments when present"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Reset dev server**

HMR should pick up everything. If not, restart `npm run dev`.

- [ ] **Step 2: Open episode workspace**

Navigate to http://localhost:3000/dramas/cmqahvjvx0001hnm0cx6zpc1j/episodes/cmqaucg420056hn0s0ilt4htw and go to "配音生成" step.

- [ ] **Step 3: Verify #11 shows multi-segment UI**

Expected: #11 card has "分 2 段" badge and 2 empty audio slots.

- [ ] **Step 4: Click "生成配音" on #11**

Expected: Both segments generate TTS, merged file saves to ttsAudioUrl, 2 audio players appear with audibly different voices (male + female).

- [ ] **Step 5: Click "批量生成全部配音"**

Expected: All 7 single-voice storyboards generate as before (regression check), #11 also gets generated.

- [ ] **Step 6: DB check**

```bash
sqlite3 prisma/db/custom.db "SELECT shotNumber, ttsAudioUrl IS NOT NULL as has_audio, ttsSegments FROM Storyboard WHERE episodeId='cmqaucg420056hn0s0ilt4htw' AND dialogue IS NOT NULL ORDER BY shotNumber;"
```
Expected: All 8 storyboards have `has_audio = 1`. #11 also has ttsSegments with audioUrl + startMs + endMs.

- [ ] **Step 7: Listen to #11 merged audio**

Download `ttsAudioUrl` for #11, verify it plays two distinct voices in order (陆辰 first, 林夕 second).

---

## Task 10: Final commit + push

- [ ] **Step 1: Verify clean working tree**

Run: `git status`
Expected: only `cookies.txt` modified (keep dirty, never commit).

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Confirm on remote**

Run: `git log origin/main --oneline -5`
Expected: includes all 8+ commits from this plan.
