/**
 * One-off cleanup: strip leaked <think>...</think> reasoning that
 * MiniMax M3's chat-completion endpoint emits into the visible
 * content field. Affects every Episode whose rawContent starts
 * with <think> (i.e. the model emitted reasoning before the actual
 * <scriptItem> output).
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/fix-think-pollution.ts --dry-run   # preview changes
 *   npx tsx scripts/fix-think-pollution.ts             # write to DB
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  // Lazy non-greedy block stripper, then drop any orphaned opening
  // tag the model may have emitted without a closing one (happens
  // when the reply runs out of tokens mid-thought). The result is
  // also trimStart()'d so the saved rawContent no longer has a
  // leading blank line that would have come from the stripped
  // reasoning block.
  const THINK_BLOCK = /<think>[\s\S]*?<\/think>\s*/g
  const DANGLE_OPEN = /<think>/g

  const episodes = await prisma.episode.findMany({
    where: {
      OR: [
        { rawContent: { contains: '<think>' } },
        { scriptContent: { contains: '<think>' } },
      ],
    },
    select: {
      id: true,
      episodeNumber: true,
      title: true,
      rawContent: true,
      scriptContent: true,
    },
  })

  console.log(`[${dryRun ? 'DRY-RUN' : 'APPLY'}] Found ${episodes.length} episodes with leaked <think> reasoning.\n`)

  for (const ep of episodes) {
    const cleanedRaw = (ep.rawContent ?? '')
      .replace(THINK_BLOCK, '')
      .replace(DANGLE_OPEN, '')
      .trimStart()

    const cleanedScript = (ep.scriptContent ?? '')
      .replace(THINK_BLOCK, '')
      .replace(DANGLE_OPEN, '')
      .trimStart()

    console.log(`  EP${ep.episodeNumber} ${ep.title}  (id=${ep.id})`)
    console.log(`    rawContent:    ${(ep.rawContent ?? '').length} → ${cleanedRaw.length}  chars`)
    console.log(`    scriptContent: ${(ep.scriptContent ?? '').length} → ${cleanedScript.length}  chars`)
    console.log(`    rawContent preview: "${cleanedRaw.slice(0, 80)}..."`)
    console.log('')

    if (!dryRun) {
      await prisma.episode.update({
        where: { id: ep.id },
        data: {
          rawContent: cleanedRaw,
          scriptContent: cleanedScript,
        },
      })
    }
  }

  console.log(dryRun
    ? '🔍 Dry-run complete. Re-run without --dry-run to write changes.'
    : '✅ All episodes cleaned.'
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
