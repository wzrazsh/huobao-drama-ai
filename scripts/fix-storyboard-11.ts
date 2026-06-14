import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  // The test drama has multiple #11 storyboards across episodes.
  // The one we want is the dual-speaker 陆辰/林夕 dialogue in the
  // production episode `cmqaucg420056hn0s0ilt4htw`.
  const storyboard = await db.storyboard.findFirst({
    where: {
      shotNumber: 11,
      episode: { dramaId: 'cmqahvjvx0001hnm0cx6zpc1j' },
      episodeId: 'cmqaucg420056hn0s0ilt4htw',
    },
  })
  if (!storyboard) {
    console.error('#11 (陆辰/林夕) not found in production episode')
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
